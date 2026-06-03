import type PQueue from 'p-queue';
import { v7 as uuidv7 } from 'uuid';

import { bridgeSyncImport, bridgeUpdateBookImport } from '@/lib/bridge';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { updateBookById } from '@/lib/db/models/book/update-book';
import { createPipelineSteps } from '@/lib/db/models/pipeline-step/create-pipeline-step';
import {
  getPipelineStepsByBookImportId,
  getPipelineStepsByBookImportIdAndStepId
} from '@/lib/db/models/pipeline-step/get-pipeline-step';
import {
  resetParentPipelineStepsToPending,
  updatePipelineStepById,
  upsertPipelineStepNarrativeLine
} from '@/lib/db/models/pipeline-step/update-pipeline-step';
import { flushLangsmith } from '@/lib/llm/tracing';

import { handlers } from '../handlers';
import { ARC_STEPS, EXTRACT_STEPS, PROJECTION_STEPS, STEPS, getStep } from './definition';
import { getEnumerator } from './enumerators';
import { seedPipelineSteps } from './seed';
import type { FanOutStep, PipelineContext, Step } from './types';

type RunnerDeps = {
  queue: PQueue;
};

type PhaseStatus = 'projection' | 'extract' | 'arc';

function phaseStatus(phase: Step[]): PhaseStatus {
  if (phase === PROJECTION_STEPS) return 'projection';
  if (phase === EXTRACT_STEPS) return 'extract';
  return 'arc';
}

export async function runImport(
  bookImportId: string,
  retryFailed: boolean,
  deps: RunnerDeps
): Promise<void> {
  try {
    await seedPipelineSteps(bookImportId);
    await maybeResetArcForReselection(bookImportId);

    while (true) {
      const phase = await pickPhase(bookImportId);
      if (!phase) return; // Either fully complete, or paused at a user-input gate.

      const bookImport = await getBookImportById(bookImportId);
      if (!bookImport) throw new Error(`Book import not found: ${bookImportId}`);

      const phaseValue = phaseStatus(phase);
      if (bookImport.status !== phaseValue) {
        await bridgeUpdateBookImport({ status: phaseValue });
      }

      await runDag(bookImportId, retryFailed, deps, phase);

      const rows = await getPipelineStepsByBookImportId(bookImportId);
      if (!allParentsComplete(phase, rows)) return;

      if (phase === PROJECTION_STEPS) {
        if (!bookImport.autoConfirmProjection) {
          await bridgeUpdateBookImport({ status: 'awaiting_projection' });
          return;
        }
        continue;
      }

      if (phase === EXTRACT_STEPS) {
        await bridgeUpdateBookImport({ status: 'awaiting_selection' });
        return;
      }

      return;
    }
  } finally {
    await flushLangsmith();
  }
}

// On reopen for re-selection, reset arc parent steps to pending so the arc phase re-runs.
async function maybeResetArcForReselection(bookImportId: string): Promise<void> {
  const bookImport = await getBookImportById(bookImportId);
  if (bookImport?.status !== 'arc') return;
  const rows = await getPipelineStepsByBookImportId(bookImportId);
  if (!allParentsComplete(ARC_STEPS, rows)) return;
  await resetParentPipelineStepsToPending(
    bookImportId,
    ARC_STEPS.map((s) => s.id)
  );
}

async function pickPhase(bookImportId: string): Promise<Step[] | null> {
  const bookImport = await getBookImportById(bookImportId);
  if (!bookImport) return null;
  if (bookImport.status === 'completed') return null;
  if (bookImport.status === 'awaiting_projection') return null;
  if (bookImport.status === 'awaiting_selection') return null;

  const rows = await getPipelineStepsByBookImportId(bookImportId);
  if (!allParentsComplete(PROJECTION_STEPS, rows)) return PROJECTION_STEPS;
  if (!allParentsComplete(EXTRACT_STEPS, rows)) return EXTRACT_STEPS;
  if (!allParentsComplete(ARC_STEPS, rows)) return ARC_STEPS;
  return null;
}

function allParentsComplete(
  steps: Step[],
  rows: Awaited<ReturnType<typeof getPipelineStepsByBookImportId>>
): boolean {
  const parentByStepId = new Map(
    rows.filter((r) => !r.fanOutKey).map((r) => [r.stepId, r])
  );
  return steps.every((s) => {
    const status = parentByStepId.get(s.id)?.status;
    return status === 'completed' || status === 'skipped';
  });
}

async function runDag(
  bookImportId: string,
  retryFailed: boolean,
  deps: RunnerDeps,
  steps: Step[]
): Promise<void> {
  await new Promise<void>((resolve) => {
    const inFlight = new Set<string>();
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    const advance = async () => {
      const state = await snapshot(bookImportId, retryFailed, steps);
      if (!state) {
        finish();
        return;
      }

      const halt = state.bookImportStatus === 'failed' && !retryFailed;
      if (halt) {
        if (inFlight.size === 0) finish();
        return;
      }

      let dispatched = 0;
      for (const stepId of state.readyIds) {
        if (inFlight.has(stepId)) continue;
        inFlight.add(stepId);
        dispatched++;
        void runStepAndChain(stepId);
      }

      if (dispatched === 0 && inFlight.size === 0) {
        finish();
      }
    };

    const runStepAndChain = async (stepId: string) => {
      try {
        await runStep(bookImportId, stepId, deps);
      } catch (err) {
        console.error(`[pipeline] runStep ${stepId} threw:`, err);
      } finally {
        inFlight.delete(stepId);
      }
      void advance();
    };

    void advance();
  });
}

type PipelineSnapshot = {
  readyIds: string[];
  hasInFlight: boolean;
  bookImportStatus: string | null;
};

async function snapshot(
  bookImportId: string,
  retryFailed: boolean,
  steps: Step[]
): Promise<PipelineSnapshot | null> {
  const bookImport = await getBookImportById(bookImportId);
  if (!bookImport) return null;

  const rows = await getPipelineStepsByBookImportId(bookImportId);
  const parentRowByStepId = new Map(
    rows.filter((r) => !r.fanOutKey).map((r) => [r.stepId, r])
  );

  const readyIds: string[] = [];
  let hasInFlight = false;

  for (const step of steps) {
    const status = parentRowByStepId.get(step.id)?.status ?? 'pending';

    if (status === 'running') hasInFlight = true;

    const isCandidate =
      status === 'pending' ||
      status === 'running' ||
      (retryFailed && status === 'failed');
    if (!isCandidate) continue;

    const depsSatisfied = step.depends.every((dep) => {
      const status = parentRowByStepId.get(dep)?.status;
      return status === 'completed' || status === 'skipped';
    });
    if (depsSatisfied) readyIds.push(step.id);
  }

  return { readyIds, hasInFlight, bookImportStatus: bookImport.status };
}

async function runStep(
  bookImportId: string,
  stepId: string,
  deps: RunnerDeps
): Promise<void> {
  const stepDef = getStep(stepId);

  const bookImport = await getBookImportById(bookImportId);
  if (!bookImport) throw new Error('Book import not found');

  const ctx: PipelineContext = {
    bookImportId,
    bookId: bookImport.bookId
  };

  if (stepDef.kind === 'fan-out') {
    await runFanOutStep(bookImportId, stepId, stepDef, ctx, deps);
  } else {
    await runSimpleStep(bookImportId, stepId, stepDef.payload(ctx), deps);
  }
}

async function runSimpleStep(
  bookImportId: string,
  stepId: string,
  payload: Record<string, unknown>,
  deps: RunnerDeps
): Promise<void> {
  const rows = await getPipelineStepsByBookImportIdAndStepId(bookImportId, stepId);
  const row = rows.find((r) => !r.fanOutKey);
  if (!row) throw new Error(`No pipeline_steps row for ${stepId}`);
  if (row.status === 'completed') return;

  await updatePipelineStepById(row.id, {
    status: 'running',
    startedAt: new Date().toISOString()
  });

  try {
    await deps.queue.add(async () => {
      const handler = handlers[stepId];
      if (!handler) throw new Error(`Unknown step: ${stepId}`);
      await handler({ executionId: row.id, payload });
    });
    await updatePipelineStepById(row.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      lastError: null
    });
    console.error(`[pipeline] Step "${stepId}" completed for ${bookImportId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updatePipelineStepById(row.id, {
      status: 'failed',
      lastError: message,
      attemptCount: row.attemptCount + 1
    });
    await bridgeUpdateBookImport({
      status: 'failed',
      lastError: `Step "${stepId}" failed: ${message}`
    });
    console.error(`[pipeline] Step "${stepId}" failed for ${bookImportId}: ${message}`);
  }
}

async function runFanOutStep(
  bookImportId: string,
  stepId: string,
  stepDef: FanOutStep,
  ctx: PipelineContext,
  deps: RunnerDeps
): Promise<void> {
  const basePayload = stepDef.payload(ctx);
  const enumerate = getEnumerator(stepDef.enumerator);
  const items = await enumerate(ctx, basePayload);

  console.error(
    `[pipeline] Fanning out "${stepId}" across ${items.length} items for ${bookImportId}`
  );

  const rows = await getPipelineStepsByBookImportIdAndStepId(bookImportId, stepId);
  const parentRow = rows.find((r) => !r.fanOutKey);
  if (!parentRow) throw new Error(`No pipeline_steps row for ${stepId}`);
  if (parentRow.status === 'completed') return;

  if (items.length === 0) {
    const now = new Date().toISOString();
    await updatePipelineStepById(parentRow.id, {
      status: 'completed',
      startedAt: parentRow.startedAt ?? now,
      completedAt: now,
      lastError: null
    });
    console.error(`[pipeline] Step "${stepId}" completed for ${bookImportId} (no items)`);
    return;
  }

  await updatePipelineStepById(parentRow.id, {
    status: 'running',
    startedAt: new Date().toISOString()
  });

  // Seed per-item rows for any new fan-out keys
  const existingKeys = new Set(rows.filter((r) => r.fanOutKey).map((r) => r.fanOutKey));
  const newItems = items.filter((item) => !existingKeys.has(item.key));
  if (newItems.length > 0) {
    await createPipelineSteps(
      newItems.map((item) => ({
        id: uuidv7(),
        bookImportId,
        stepId,
        fanOutKey: item.key,
        status: 'pending' as const,
        lastError: null,
        startedAt: null,
        completedAt: null
      }))
    );
  }

  const allRows = await getPipelineStepsByBookImportIdAndStepId(bookImportId, stepId);
  const itemRowMap = new Map(
    allRows.filter((r) => r.fanOutKey).map((r) => [r.fanOutKey!, r])
  );

  const totalCount = items.length;
  let completedCount = allRows.filter(
    (r) => r.fanOutKey && r.status === 'completed'
  ).length;
  const progressLineId = 'fanout-progress';
  const writeProgress = () =>
    upsertPipelineStepNarrativeLine(parentRow.id, {
      id: progressLineId,
      text: `${stepDef.progressNarrative} ${completedCount}/${totalCount}`
    });
  await writeProgress();

  const results = await Promise.allSettled(
    items.map((item) =>
      deps.queue.add(async () => {
        const itemRow = itemRowMap.get(item.key);
        if (!itemRow) throw new Error(`No pipeline_steps row for ${stepId}:${item.key}`);
        if (itemRow.status === 'completed') return;

        await updatePipelineStepById(itemRow.id, {
          status: 'running',
          startedAt: new Date().toISOString()
        });

        try {
          const handler = handlers[stepId];
          if (!handler) throw new Error(`Unknown step: ${stepId}`);
          await handler({ executionId: itemRow.id, payload: item.payload });
          await updatePipelineStepById(itemRow.id, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            lastError: null
          });
          completedCount++;
          await writeProgress();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await updatePipelineStepById(itemRow.id, {
            status: 'failed',
            lastError: message,
            attemptCount: itemRow.attemptCount + 1
          });
          throw error;
        }
      })
    )
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    const firstError = (failures[0] as PromiseRejectedResult).reason;
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    await updatePipelineStepById(parentRow.id, {
      status: 'failed',
      lastError: `${failures.length}/${items.length} items failed. First: ${message}`,
      attemptCount: parentRow.attemptCount + 1
    });
    await bridgeUpdateBookImport({
      status: 'failed',
      lastError: `Step "${stepId}" failed: ${failures.length}/${items.length} items failed`
    });
    console.error(
      `[pipeline] Step "${stepId}" failed for ${bookImportId}: ${failures.length}/${items.length} items failed`
    );
    return;
  }

  await updatePipelineStepById(parentRow.id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    lastError: null
  });
  console.error(
    `[pipeline] Step "${stepId}" completed for ${bookImportId} (${items.length} items)`
  );
}

export async function finalizeBookImportStatus(bookImportId: string): Promise<void> {
  const rows = await getPipelineStepsByBookImportId(bookImportId);
  const parentRowByStepId = new Map(
    rows.filter((r) => !r.fanOutKey).map((r) => [r.stepId, r])
  );

  const allDone = STEPS.every((step) => {
    const status = parentRowByStepId.get(step.id)?.status;
    return status === 'completed' || status === 'skipped';
  });

  const bookImport = await getBookImportById(bookImportId);
  if (!bookImport) return;

  if (allDone && bookImport.status !== 'completed') {
    await bridgeSyncImport();
    await bridgeUpdateBookImport({
      status: 'completed',
      lastError: null
    });
    if (bookImport.bookId) {
      await updateBookById(bookImport.bookId, { status: 'completed' });
    }
    console.error(`[pipeline] Book import ${bookImportId} completed`);
  }
}
