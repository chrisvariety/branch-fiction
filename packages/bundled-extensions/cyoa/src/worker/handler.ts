import type { AssistantMessage } from '@earendil-works/pi-ai';

import type { LogLevel, LogLine } from '@/lib/db/types';
import { appendFirstLaunchStepLog } from '@/worker/db/models/first-launch-step/update-first-launch-step';
import { getPiModel } from '@/worker/providers';

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

export type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  withMetadata: (metadata: Record<string, unknown>) => Logger;
};

export type WorkflowContext = {
  executionId: string;
  retryCount: number;
  getPiModel: typeof getPiModel;
  log: Logger;
  trackUsage: (message: AssistantMessage) => void;
  fs: ExtensionHost['fs'];
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

function createStepLogger(executionId: string): {
  logger: Logger;
  drain: () => Promise<void>;
} {
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (label: string, work: () => Promise<void>) => {
    queue = queue.then(() =>
      work().catch((e) => {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error(`[${label} queue] ${err.message}`);
      })
    );
  };

  function makeLogger(metadata?: Record<string, unknown>): Logger {
    const emit = (level: LogLevel, args: unknown[]) => {
      const message = fmtLogArgs(args);
      const meta = metadata ? ` ${JSON.stringify(metadata)}` : '';
      console[level](`[${level}]${meta} ${message}`);
      const line: LogLine = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...(metadata ? { metadata } : {})
      };
      enqueue('ctx.log', () => appendFirstLaunchStepLog(executionId, line));
    };
    return {
      info: (...args) => emit('info', args),
      warn: (...args) => emit('warn', args),
      error: (...args) => emit('error', args),
      debug: (...args) => emit('debug', args),
      withMetadata: (more) => makeLogger(metadata ? { ...metadata, ...more } : more)
    };
  }

  return { logger: makeLogger(), drain: () => queue };
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
      const { logger: log, drain: drainLog } = createStepLogger(executionId);
      try {
        const result = await handler(transformedPayload, {
          executionId,
          retryCount: attempt,
          getPiModel,
          log,
          trackUsage: () => {},
          fs: host.fs
        });

        if (config.check) {
          try {
            await config.check(transformedPayload, result);
          } catch (e) {
            console.warn('[workflow] asset check failed', e);
          }
        }

        await drainLog();
        return result;
      } catch (error) {
        await drainLog();
        lastError = error instanceof Error ? error : new Error(String(error));
        const maxRetries = getRetryLimit(lastError);

        console.error(
          `[workflow] ${workflowName} error (attempt ${attempt}/${maxRetries}):`,
          lastError
        );

        if (attempt >= maxRetries) break;

        const delay = backoffMs(attempt);
        console.log(`[workflow] retrying in ${delay}ms`);
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

export function addOrdinalSuffix(n: number): string {
  return (
    n +
    ['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]
  );
}
