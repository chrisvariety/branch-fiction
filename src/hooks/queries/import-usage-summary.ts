import { queryOptions } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';

export type ImportUsageSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  costTotal: number;
  callsWithReasoning: number;
  callsWithCacheRead: number;
};

async function fetchImportUsageSummary(
  bookImportId: string
): Promise<ImportUsageSummary> {
  return invoke<ImportUsageSummary>('read_pipeline_step_usages_for_import', {
    bookImportId
  });
}

export function importUsageSummaryQueryOptions(bookImportId: string) {
  return queryOptions({
    queryKey: ['import-usage-summary', bookImportId] as const,
    queryFn: () => fetchImportUsageSummary(bookImportId)
  });
}
