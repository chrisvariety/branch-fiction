import { queryOptions } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';

export type ModelProjection = {
  bookImportId: string;
  pipelineStepId: string;
  stepId: string;
  completedAt: string;
  wallSec: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  costTotal: number;
};

const PROJECTION_STEP_IDS = ['preliminary_scenes_preview', 'preliminary_scenes'];

async function fetchModelProjection(
  provider: string,
  model: string
): Promise<ModelProjection | null> {
  return invoke<ModelProjection | null>('read_model_projection', {
    provider,
    model,
    stepIds: PROJECTION_STEP_IDS
  });
}

export function modelProjectionQueryOptions(
  provider: string | null | undefined,
  model: string | null | undefined
) {
  return queryOptions({
    queryKey: ['model-projection', provider, model] as const,
    queryFn: () => fetchModelProjection(provider!, model!),
    enabled: !!provider && !!model
  });
}
