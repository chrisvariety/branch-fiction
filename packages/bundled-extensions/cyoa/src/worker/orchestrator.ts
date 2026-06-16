import { v7 as uuidv7 } from 'uuid';

import type {
  BookInteractive,
  FirstLaunchStep,
  FirstLaunchStepId,
  NewFirstLaunchStep
} from '@/lib/db/types';
import { ensureDbReady } from '@/worker/db';
import { getBookEntitiesByIds } from '@/worker/db/models/book-entity/get-book-entity';
import { getBookInteractiveByBookIdAndTypeAndStatus } from '@/worker/db/models/book-interactive/get-book-interactive';
import { createFirstLaunchSteps } from '@/worker/db/models/first-launch-step/create-first-launch-step';
import { getFirstLaunchStepsByBookId } from '@/worker/db/models/first-launch-step/get-first-launch-step';
import {
  markFirstLaunchStepDone,
  markFirstLaunchStepError,
  markFirstLaunchStepRunning
} from '@/worker/db/models/first-launch-step/update-first-launch-step';

import { handler as finalizeCharacterInteractive } from './post-process-book/finalize-character-interactive';
import { handler as finalizePlaceInteractive } from './post-process-book/finalize-place-interactive';
import { handler as generateCharacterInteractive } from './post-process-book/generate-character-interactive';
import { handler as generateCharacterReferenceImage } from './post-process-book/generate-character-reference-image';
import { handler as generatePlaceInteractive } from './post-process-book/generate-place-interactive';

export interface RunFirstLaunchPayload {
  characterIds: string[];
  placeIds: string[];
}

function needsRun(step: FirstLaunchStep): boolean {
  return step.completedAt === null || step.lastError !== null;
}

async function runStep<T>(step: FirstLaunchStep, fn: () => Promise<T>): Promise<T> {
  await markFirstLaunchStepRunning(step.id);
  try {
    const result = await fn();
    await markFirstLaunchStepDone(step.id);
    return result;
  } catch (err) {
    const message =
      err instanceof Error
        ? err.stack
          ? `${err.message}\n${err.stack}`
          : err.message
        : String(err);
    await markFirstLaunchStepError(step.id, message);
    throw err;
  }
}

async function ensureSteps(
  bookId: string,
  payload: RunFirstLaunchPayload
): Promise<FirstLaunchStep[]> {
  const existing = await getFirstLaunchStepsByBookId(bookId);
  if (existing.length > 0) return existing;

  const characters = await getBookEntitiesByIds(payload.characterIds);
  if (characters.length === 0) {
    throw new Error('No characters resolved from picked ids');
  }
  if (payload.placeIds.length === 0) {
    throw new Error('No places resolved from picked ids');
  }

  const rows: NewFirstLaunchStep[] = [
    ...characters.map((c) => ({
      id: uuidv7(),
      bookId,
      stepId: 'character_reference_image' as const,
      fanOutKey: c.id
    })),
    {
      id: uuidv7(),
      bookId,
      stepId: 'character_interactive_generate' as const,
      fanOutKey: null
    },
    {
      id: uuidv7(),
      bookId,
      stepId: 'character_interactive_finalize' as const,
      fanOutKey: null
    },
    {
      id: uuidv7(),
      bookId,
      stepId: 'place_interactive_generate' as const,
      fanOutKey: null
    },
    {
      id: uuidv7(),
      bookId,
      stepId: 'place_interactive_finalize' as const,
      fanOutKey: null
    }
  ];
  // insert-or-ignore + re-select so concurrent starters converge on one row set
  await createFirstLaunchSteps(rows);
  return getFirstLaunchStepsByBookId(bookId);
}

function throwIfAnyRejected(
  label: string,
  results: PromiseSettledResult<unknown>[]
): void {
  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected'
  );
  if (failures.length === 0) return;
  const first = failures[0].reason;
  const message = first instanceof Error ? first.message : String(first);
  throw new Error(
    `${failures.length}/${results.length} ${label} steps failed. First: ${message}`
  );
}

export async function runFirstLaunch(payload: RunFirstLaunchPayload): Promise<void> {
  if (host.bookId === null) {
    throw new Error('runFirstLaunch requires a bookId — launch from a book');
  }
  const bookId = host.bookId;

  await ensureDbReady();
  const steps = await ensureSteps(bookId, payload);

  const findStep = (stepId: FirstLaunchStepId, fanOutKey: string | null = null) => {
    const found = steps.find((s) => s.stepId === stepId && s.fanOutKey === fanOutKey);
    if (!found) throw new Error(`Missing step row: ${stepId}/${fanOutKey ?? '∅'}`);
    return found;
  };

  // allSettled so one failure drains in-flight siblings instead of killing them mid-write
  const refSteps = steps.filter((s) => s.stepId === 'character_reference_image');
  const refResults = await Promise.allSettled(
    refSteps.filter(needsRun).map((step) =>
      runStep(step, () =>
        generateCharacterReferenceImage({
          executionId: step.id,
          payload: { bookEntityId: step.fanOutKey!, bookId }
        })
      )
    )
  );
  throwIfAnyRejected('reference image', refResults);

  const chainResults = await Promise.allSettled([
    runInteractiveChain({
      bookId,
      type: 'CHARACTER_VERTICAL', // TODO make actual part of bookSettings
      generateStep: findStep('character_interactive_generate'),
      finalizeStep: findStep('character_interactive_finalize'),
      generate: generateCharacterInteractive,
      finalize: finalizeCharacterInteractive
    }),
    runInteractiveChain({
      bookId,
      type: 'PLACE_VERTICAL', // TODO make actual part of bookSettings
      generateStep: findStep('place_interactive_generate'),
      finalizeStep: findStep('place_interactive_finalize'),
      generate: generatePlaceInteractive,
      finalize: finalizePlaceInteractive
    })
  ]);
  throwIfAnyRejected('interactive', chainResults);
}

type InteractiveType = BookInteractive['type'];

interface ChainArgs {
  bookId: string;
  type: InteractiveType;
  generateStep: FirstLaunchStep;
  finalizeStep: FirstLaunchStep;
  generate: (input: {
    executionId: string;
    payload: { bookId: string; type: InteractiveType };
  }) => Promise<unknown>;
  finalize: (input: {
    executionId: string;
    payload: { bookId: string; interactiveId: string };
  }) => Promise<unknown>;
}

async function runInteractiveChain(args: ChainArgs): Promise<void> {
  let interactiveId: string | undefined;

  if (needsRun(args.generateStep)) {
    const result = (await runStep(args.generateStep, () =>
      args.generate({
        executionId: args.generateStep.id,
        payload: { bookId: args.bookId, type: args.type }
      })
    )) as { interactiveId?: string };
    interactiveId = result.interactiveId;
  }

  if (needsRun(args.finalizeStep)) {
    if (!interactiveId) {
      const existing = await getBookInteractiveByBookIdAndTypeAndStatus(
        args.bookId,
        args.type,
        'draft'
      );
      interactiveId = existing?.id;
    }
    if (!interactiveId) {
      throw new Error(`No interactive found to finalize for ${args.type}`);
    }
    await runStep(args.finalizeStep, () =>
      args.finalize({
        executionId: args.finalizeStep.id,
        payload: { bookId: args.bookId, interactiveId: interactiveId! }
      })
    );
  }
}
