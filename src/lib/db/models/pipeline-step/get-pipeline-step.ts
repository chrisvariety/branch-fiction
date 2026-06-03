import { invoke } from '@tauri-apps/api/core';

import type { PipelineStep } from '../../types';

// TODO remove this - it's not a model, it's just pretending to be one :(
export async function getPipelineStepsByBookImportId(
  bookImportId: string
): Promise<PipelineStep[]> {
  return invoke<PipelineStep[]>('read_pipeline_steps_for_import', { bookImportId });
}

// ditto
export async function getPipelineStepsByBookImportIdAndStepId(
  bookImportId: string,
  stepId: string
): Promise<PipelineStep[]> {
  return invoke<PipelineStep[]>('read_pipeline_steps_for_import', {
    bookImportId,
    stepId
  });
}
