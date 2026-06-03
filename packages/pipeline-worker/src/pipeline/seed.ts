import { v7 as uuidv7 } from 'uuid';

import type { NewPipelineStep } from '@/app/lib/db/types';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { createPipelineSteps } from '@/lib/db/models/pipeline-step/create-pipeline-step';
import { getPipelineStepsByBookImportId } from '@/lib/db/models/pipeline-step/get-pipeline-step';

import { STEP_IDS } from './definition';

export async function seedPipelineSteps(bookImportId: string) {
  const existing = await getPipelineStepsByBookImportId(bookImportId);
  if (existing.length > 0) return existing;

  const bookImport = await getBookImportById(bookImportId);
  const skipProjection = bookImport?.autoConfirmProjection ?? false;

  const rows: NewPipelineStep[] = STEP_IDS.map((stepId) => ({
    id: uuidv7(),
    bookImportId,
    stepId,
    fanOutKey: null,
    status:
      skipProjection && stepId === 'preliminary_scenes_preview'
        ? ('skipped' as const)
        : ('pending' as const),
    lastError: null,
    startedAt: null,
    completedAt: null
  }));

  return createPipelineSteps(rows);
}
