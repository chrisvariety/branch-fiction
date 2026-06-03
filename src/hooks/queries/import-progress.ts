import { queryOptions } from '@tanstack/react-query';

import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getPipelineStepsByBookImportId } from '@/lib/db/models/pipeline-step/get-pipeline-step';
import { transformImageUrl } from '@/lib/media/transform-url';
import { listRunningImports } from '@/lib/pipeline';

async function fetchImportProgress(bookImportId: string) {
  const [bookImport, rows, running] = await Promise.all([
    getBookImportById(bookImportId),
    getPipelineStepsByBookImportId(bookImportId),
    listRunningImports()
  ]);
  if (!bookImport) throw new Error('Book import not found');

  const parentRows = rows.filter((row) => !row.fanOutKey);

  let currentStep: string | null = null;
  let completedCount = 0;

  const steps = parentRows.map((row) => {
    if (row.status === 'completed' || row.status === 'skipped') completedCount++;
    if (row.status === 'running' && !currentStep) currentStep = row.stepId;

    return {
      stepId: row.stepId,
      status: row.status,
      lastError: row.lastError ?? null,
      narrative: row.narrative ?? [],
      logs: row.logs ?? []
    };
  });

  const book = bookImport.bookId ? await getBookById(bookImport.bookId) : null;

  return {
    bookImportId,
    bookId: bookImport.bookId,
    bookSlug: book?.slug ?? null,
    bookStatus: book?.status ?? null,
    imageUrl: bookImport.imageUrl ? transformImageUrl(bookImport.imageUrl) : null,
    title: book?.title ?? bookImport.title,
    status: bookImport.status,
    notificationsEnabled: bookImport.notificationsEnabled,
    autoConfirmProjection: bookImport.autoConfirmProjection,
    isActive: running.includes(bookImportId),
    steps,
    completedCount,
    totalCount: parentRows.length,
    currentStep,
    etaMinSeconds: bookImport.etaMinSeconds,
    etaMaxSeconds: bookImport.etaMaxSeconds,
    costMinCents: bookImport.costMinCents,
    costMaxCents: bookImport.costMaxCents,
    projectionBehavior: bookImport.projectionBehavior
  };
}

export function importProgressQueryOptions(bookImportId: string) {
  return queryOptions({
    queryKey: ['import-progress', bookImportId] as const,
    queryFn: () => fetchImportProgress(bookImportId)
  });
}

export type ImportProgress = Awaited<ReturnType<typeof fetchImportProgress>>;
