import type { AssistantMessage } from '@earendil-works/pi-ai';
import { serializeError } from 'serialize-error';
import { v7 as uuidv7 } from 'uuid';

import type { LogLevel, LogLine } from '@/app/lib/db/types';
import { bridgeProxyBaseUrl, bridgeUpdateBookImport, fetchSlotInfo } from '@/lib/bridge';
import { createPipelineStepUsage } from '@/lib/db/models/pipeline-step-usage/create-pipeline-step-usage';
import {
  appendPipelineStepLog,
  appendPipelineStepNarrativeLine,
  updatePipelineStepById,
  upsertPipelineStepNarrativeLine
} from '@/lib/db/models/pipeline-step/update-pipeline-step';
import { estimateTokens } from '@/lib/llm/estimate-tokens';
import { createGetPiModel, type PiModelHandle, type Slot } from '@/lib/llm/models';
import {
  createStepTracer,
  type TraceAgentFn,
  type TraceCompleteFn
} from '@/lib/llm/tracing';

export type AssetCheckResult = {
  passed: boolean;
  severity?: 'WARN' | 'ERROR';
  metadata?: Record<string, string | number | boolean>;
};

type WorkflowConfig<TData, TPayload = TData, TResult = unknown> = {
  name: string | ((payload: TPayload, retryCount: number) => string);
  payload?: (data: TData) => Promise<TPayload>;
  onFailure?: (event: TPayload, error: Error) => Promise<void>;
  check?: (payload: TPayload, resultJson: TResult) => Promise<AssetCheckResult>;
};

export type NarrationLine = {
  update: (text: string) => Promise<void>;
};

export type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  withMetadata: (metadata: Record<string, unknown>) => Logger;
};

export type ProjectionUpdate = {
  eta: { minSeconds: number; maxSeconds: number };
  cost: { minCents: number; maxCents: number } | null;
  behavior: 'normal' | 'unknown';
};

export type StepMetrics = {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
};

export type WorkflowContext = {
  executionId: string;
  retryCount: number;
  getPiModel: (slot: Slot) => PiModelHandle;
  narrate: (text: string) => Promise<NarrationLine>;
  log: Logger;
  trackUsage: (message: AssistantMessage) => void;
  traceComplete: TraceCompleteFn;
  traceAgent: TraceAgentFn;
  updateProjection: (update: ProjectionUpdate) => void;
  metricsThisStep: () => StepMetrics;
};

function fmtLogArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

type Enqueue = (label: string, work: () => Promise<void>) => void;

function createStepLogger(
  executionId: string,
  enqueue: Enqueue
): {
  logger: Logger;
  trackUsage: (message: AssistantMessage) => void;
  updateProjection: (update: ProjectionUpdate) => void;
  metricsThisStep: () => StepMetrics;
} {
  const stepMetrics: StepMetrics = {
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0
  };

  function makeLogger(metadata?: Record<string, unknown>): Logger {
    const emit = (level: LogLevel, args: unknown[]) => {
      const message = fmtLogArgs(args);
      console[level](`[${level}] ${message}`);
      const line: LogLine = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...(metadata ? { metadata } : {})
      };
      enqueue('ctx.log', () => appendPipelineStepLog(executionId, line));
    };
    return {
      info: (...args) => emit('info', args),
      warn: (...args) => emit('warn', args),
      error: (...args) => emit('error', args),
      debug: (...args) => emit('debug', args),
      withMetadata: (more) => makeLogger(metadata ? { ...metadata, ...more } : more)
    };
  }

  const trackUsage = (message: AssistantMessage) => {
    const { usage } = message;
    const reasoningTokens = estimateReasoningTokens(message);
    stepMetrics.calls++;
    stepMetrics.inputTokens += usage.input;
    stepMetrics.cachedInputTokens += usage.cacheRead;
    stepMetrics.outputTokens += usage.output;
    stepMetrics.reasoningTokens += reasoningTokens;
    stepMetrics.costUsd += usage.cost.total ?? 0;
    enqueue('ctx.trackUsage', async () => {
      await createPipelineStepUsage({
        id: uuidv7(),
        pipelineStepId: executionId,
        provider: message.provider,
        model: message.model,
        responseModel: message.responseModel ?? null,
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite,
        reasoningTokens,
        totalTokens: usage.totalTokens,
        costInput: usage.cost.input,
        costOutput: usage.cost.output,
        costCacheRead: usage.cost.cacheRead,
        costCacheWrite: usage.cost.cacheWrite,
        costTotal: usage.cost.total
      });
    });
  };

  const updateProjection = ({ eta, cost, behavior }: ProjectionUpdate) => {
    const etaLo = Math.max(1, Math.round(eta.minSeconds));
    const etaHi = Math.max(etaLo, Math.round(eta.maxSeconds));
    const costLo = cost ? Math.max(0, Math.round(cost.minCents)) : null;
    const costHi = cost ? Math.max(costLo ?? 0, Math.round(cost.maxCents)) : null;
    enqueue('ctx.updateProjection', async () => {
      await bridgeUpdateBookImport({
        etaMinSeconds: etaLo,
        etaMaxSeconds: etaHi,
        costMinCents: costLo,
        costMaxCents: costHi,
        projectionBehavior: behavior
      });
    });
  };

  return {
    logger: makeLogger(),
    trackUsage,
    updateProjection,
    metricsThisStep: () => ({ ...stepMetrics })
  };
}

const RETRY_LIMITS: Record<string, number> = {
  UnrecoverableError: 0,
  RecoverableError: 10
};
const DEFAULT_RETRY_LIMIT = 3;

function getRetryLimit(err: Error): number {
  return RETRY_LIMITS[err.name] ?? DEFAULT_RETRY_LIMIT;
}

function backoffMs(attempt: number): number {
  return Math.min(10_000 * 2 ** attempt, 60_000);
}

export function createWorkflowFunction<TData, TPayload = TData, TResult = unknown>(
  config: WorkflowConfig<TData, TPayload, TResult>,
  handler: (event: TPayload, ctx: WorkflowContext) => Promise<TResult>
) {
  return async ({
    executionId,
    payload
  }: {
    executionId: string;
    payload: TData;
  }): Promise<TResult> => {
    const transformedPayload = config.payload
      ? await config.payload(payload)
      : (payload as unknown as TPayload);

    const workflowName =
      typeof config.name === 'string' ? config.name : config.name(transformedPayload, 0);

    console.log(`[workflow] ${workflowName} (${executionId})`);

    let lastError: Error | undefined;

    for (let attempt = 0; ; attempt++) {
      let queue: Promise<void> = Promise.resolve();
      const enqueue: Enqueue = (label, work) => {
        queue = queue.then(() =>
          work().catch((e) => {
            const err = e instanceof Error ? e : new Error(String(e));
            console.error(`[${label} queue] ${err.message}`);
          })
        );
      };
      const drain = () => queue;

      const {
        logger: log,
        trackUsage,
        updateProjection,
        metricsThisStep
      } = createStepLogger(executionId, enqueue);
      const tracer = createStepTracer({
        executionId,
        workflowName,
        attempt,
        enqueue
      });
      try {
        await updatePipelineStepById(executionId, { narrative: [] });

        const slots = await fetchSlotInfo();
        const getPiModel = createGetPiModel(slots, bridgeProxyBaseUrl());

        const result = await handler(transformedPayload, {
          executionId,
          retryCount: attempt,
          getPiModel,
          narrate: async (text) => {
            const lineId = uuidv7();
            await appendPipelineStepNarrativeLine(executionId, {
              id: lineId,
              text
            });
            return {
              update: (newText) =>
                upsertPipelineStepNarrativeLine(executionId, {
                  id: lineId,
                  text: newText
                })
            };
          },
          log,
          trackUsage,
          traceComplete: tracer.traceComplete,
          traceAgent: tracer.traceAgent,
          updateProjection,
          metricsThisStep
        });

        if (config.check) {
          try {
            await config.check(transformedPayload, result);
          } catch (e) {
            console.warn('[workflow] asset check failed', e);
          }
        }

        tracer.end({ metrics: metricsThisStep() });
        await drain();
        return result;
      } catch (error) {
        tracer.fail(error);
        await drain();
        lastError = error instanceof Error ? error : new Error(String(error));
        const maxRetries = getRetryLimit(lastError);

        console.error(
          `[workflow] ${workflowName} error (attempt ${attempt}/${maxRetries}):`,
          lastError
        );

        if (attempt >= maxRetries) break;

        const delay = backoffMs(attempt);
        console.log(`[workflow] retrying in ${delay}ms`);
        const serialized = JSON.stringify(serializeError(lastError), null, 2);
        await appendPipelineStepNarrativeLine(executionId, {
          id: uuidv7(),
          text: `Ran into an error. Retrying in ${Math.round(delay / 1000)}s.\n\n${serialized}`,
          kind: 'error'
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const err = lastError!;

    if (config.onFailure) {
      await config.onFailure(transformedPayload, err);
    }

    throw err;
  };
}

// Reasoning tokens bill as `output`; this counts only visible ThinkingContent (positive-only signal).
function estimateReasoningTokens(message: AssistantMessage): number {
  let total = 0;
  for (const part of message.content) {
    if (part.type === 'thinking' && part.thinking) {
      total += estimateTokens(part.thinking);
    }
  }
  return total;
}

export function addOrdinalSuffix(n: number): string {
  return (
    n +
    ['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]
  );
}
