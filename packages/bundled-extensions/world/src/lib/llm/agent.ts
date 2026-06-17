import type { Agent } from '@earendil-works/pi-agent-core';
import { complete, type AssistantMessage } from '@earendil-works/pi-ai';

import { extractWrappedXml } from '@/lib/llm/xml';
import type { WorkflowContext } from '@/worker/handler';

export type AgentToolCall = { name: string; args: Record<string, unknown> };

export type AgentWatcher = {
  xml: string | null;
  toolCalls: AgentToolCall[];
};

export function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

// pi-ai resolves complete() with a message whose stopReason is "error" instead
// of rejecting — convert that back to a throw so callers don't see empty text.
export async function completeOrThrow(
  ...args: Parameters<typeof complete>
): Promise<AssistantMessage> {
  const message = await complete(...args);
  if (message.stopReason === 'error') {
    throw new Error(message.errorMessage || 'LLM provider returned an error');
  }
  return message;
}

export function watchAgent(
  agent: Agent,
  ctx: WorkflowContext,
  wrapperTag?: string
): AgentWatcher {
  const watcher: AgentWatcher = { xml: null, toolCalls: [] };

  agent.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      ctx.trackUsage(event.message);
      const text = getAssistantText(event.message);

      const captured = wrapperTag ? extractWrappedXml(text, wrapperTag) : null;
      if (captured !== null) {
        ctx.log.info(`Agent: captured xml (length: ${text.length})`);
        watcher.xml = captured;
      } else if (text.trim()) {
        ctx.log.info(`Agent: ${text}`);
      }
    } else if (event.type === 'tool_execution_start') {
      ctx.log.info(`Calling tool: ${event.toolName} ${JSON.stringify(event.args)}`);
      watcher.toolCalls.push({
        name: event.toolName,
        args: (event.args ?? {}) as Record<string, unknown>
      });
    }
  });

  return watcher;
}
