import type { Agent } from '@earendil-works/pi-agent-core';
import {
  type Api,
  type AssistantMessage,
  complete,
  type Context,
  type Model,
  type ProviderStreamOptions
} from '@earendil-works/pi-ai';
import { Client, RunTree } from 'langsmith';
import { serializeError } from 'serialize-error';
import { v7 as uuidv7 } from 'uuid';

const enabled = !!process.env.LANGSMITH_API_KEY;
const projectName = process.env.LANGSMITH_PROJECT;

let sharedClient: Client | null = null;
function getClient(): Client | null {
  if (!enabled) return null;
  if (!sharedClient) sharedClient = new Client();
  return sharedClient;
}

export function isLangsmithEnabled(): boolean {
  return enabled;
}

export async function flushLangsmith(): Promise<void> {
  if (sharedClient) await sharedClient.awaitPendingTraceBatches();
}

export type TraceCompleteFn = <TApi extends Api>(
  name: string,
  model: Model<TApi>,
  context: Context,
  options?: ProviderStreamOptions
) => Promise<AssistantMessage>;

export type TraceAgentFn = (name: string, agent: Agent) => void;

export type StepTracer = {
  traceComplete: TraceCompleteFn;
  traceAgent: TraceAgentFn;
  end: (outputs?: Record<string, unknown>) => void;
  fail: (error: unknown) => void;
};

type Enqueue = (label: string, work: () => Promise<void>) => void;

function errorString(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(serializeError(error));
  } catch {
    return String(error);
  }
}

// pi-ai resolves complete() with a message whose stopReason is "error" instead
// of rejecting — convert that back to a throw so callers don't see empty text.
async function completeOrThrow(
  ...args: Parameters<typeof complete>
): Promise<AssistantMessage> {
  const message = await complete(...args);
  if (message.stopReason === 'error') {
    throw new Error(message.errorMessage || 'LLM provider returned an error');
  }
  return message;
}

function buildUsageMetadata(usage: AssistantMessage['usage']): Record<string, unknown> {
  return {
    input_tokens: usage.input,
    output_tokens: usage.output,
    total_tokens: usage.totalTokens,
    input_token_details: {
      cache_read: usage.cacheRead,
      cache_write: usage.cacheWrite
    },
    input_cost: usage.cost.input ?? 0,
    output_cost: usage.cost.output ?? 0,
    total_cost: usage.cost.total ?? 0,
    input_cost_details: {
      cache_read: usage.cost.cacheRead ?? 0,
      cache_write: usage.cost.cacheWrite ?? 0
    }
  };
}

export function createStepTracer({
  executionId,
  workflowName,
  attempt,
  enqueue
}: {
  executionId: string;
  workflowName: string;
  attempt: number;
  enqueue: Enqueue;
}): StepTracer {
  const client = getClient();
  if (!client) {
    return {
      traceComplete: (_name, model, context, options) =>
        completeOrThrow(model, context, options),
      traceAgent: () => {},
      end: () => {},
      fail: () => {}
    };
  }

  const parent = new RunTree({
    id: uuidv7(),
    name: workflowName,
    run_type: 'chain',
    inputs: { executionId, attempt },
    client,
    project_name: projectName,
    extra: {
      metadata: { executionId, attempt }
    }
  });

  enqueue('langsmith.parent.post', () => parent.postRun());

  const traceComplete: TraceCompleteFn = async (name, model, context, options) => {
    const child = parent.createChild({
      id: uuidv7(),
      name,
      run_type: 'llm',
      inputs: {
        messages: context.messages,
        systemPrompt: context.systemPrompt,
        tools: context.tools
      },
      extra: {
        metadata: {
          executionId,
          attempt,
          model: model.id,
          provider: model.provider
        }
      }
    });
    enqueue('langsmith.child.post', () => child.postRun());

    try {
      const message = await completeOrThrow(model, context, options);
      enqueue('langsmith.child.end', async () => {
        child.metadata.usage_metadata = buildUsageMetadata(message.usage);
        await child.end({
          content: message.content,
          model: message.model,
          responseModel: message.responseModel,
          stopReason: message.stopReason,
          usage: message.usage
        });
        await child.patchRun();
      });
      return message;
    } catch (e) {
      enqueue('langsmith.child.fail', async () => {
        await child.end(undefined, errorString(e));
        await child.patchRun();
      });
      throw e;
    }
  };

  const traceAgent: TraceAgentFn = (name, agent) => {
    const agentRun = parent.createChild({
      id: uuidv7(),
      name,
      run_type: 'chain',
      inputs: {},
      extra: { metadata: { executionId, attempt, kind: 'agent' } }
    });

    let agentPosted = false;
    let currentLlmRun: RunTree | null = null;
    const toolRuns = new Map<string, RunTree>();

    agent.subscribe((event) => {
      if (event.type === 'agent_start') {
        agentRun.inputs = { messages: [...agent.state.messages] };
        agentPosted = true;
        enqueue('langsmith.agent.post', () => agentRun.postRun());
      } else if (event.type === 'message_start' && event.message.role === 'assistant') {
        const inputMessages = agent.state.messages.filter((m) => m !== event.message);
        const llmRun = agentRun.createChild({
          id: uuidv7(),
          name: 'llm',
          run_type: 'llm',
          inputs: { messages: inputMessages, systemPrompt: agent.state.systemPrompt },
          extra: {
            metadata: {
              executionId,
              attempt,
              model: agent.state.model.id,
              provider: agent.state.model.provider
            }
          }
        });
        currentLlmRun = llmRun;
        enqueue('langsmith.agent.llm.post', () => llmRun.postRun());
      } else if (
        event.type === 'message_end' &&
        event.message.role === 'assistant' &&
        currentLlmRun
      ) {
        const llmRun = currentLlmRun;
        currentLlmRun = null;
        const m = event.message;
        enqueue('langsmith.agent.llm.end', async () => {
          llmRun.metadata.usage_metadata = buildUsageMetadata(m.usage);
          await llmRun.end({
            content: m.content,
            model: m.model,
            responseModel: m.responseModel,
            stopReason: m.stopReason,
            usage: m.usage
          });
          await llmRun.patchRun();
        });
      } else if (event.type === 'tool_execution_start') {
        const toolRun = agentRun.createChild({
          id: uuidv7(),
          name: event.toolName,
          run_type: 'tool',
          inputs: { args: event.args },
          extra: { metadata: { executionId, attempt, toolCallId: event.toolCallId } }
        });
        toolRuns.set(event.toolCallId, toolRun);
        enqueue('langsmith.agent.tool.post', () => toolRun.postRun());
      } else if (event.type === 'tool_execution_end') {
        const toolRun = toolRuns.get(event.toolCallId);
        toolRuns.delete(event.toolCallId);
        if (!toolRun) return;
        enqueue('langsmith.agent.tool.end', async () => {
          if (event.isError) {
            await toolRun.end(undefined, errorString(event.result));
          } else {
            await toolRun.end({ result: event.result });
          }
          await toolRun.patchRun();
        });
      } else if (event.type === 'agent_end') {
        if (!agentPosted) return;
        enqueue('langsmith.agent.end', async () => {
          await agentRun.end({ messages: event.messages });
          await agentRun.patchRun();
        });
      }
    });
  };

  return {
    traceComplete,
    traceAgent,
    end: (outputs) => {
      enqueue('langsmith.parent.end', async () => {
        await parent.end(outputs ?? {});
        await parent.patchRun();
      });
    },
    fail: (error) => {
      enqueue('langsmith.parent.fail', async () => {
        await parent.end(undefined, errorString(error));
        await parent.patchRun();
      });
    }
  };
}
