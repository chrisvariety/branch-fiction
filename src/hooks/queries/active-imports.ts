import { queryOptions } from '@tanstack/react-query';

import { getActiveBookImports } from '@/lib/db/models/book-import/get-book-import';
import { transformImageUrl } from '@/lib/media/transform-url';
import { listRunningImports } from '@/lib/pipeline';

async function fetchActiveImports() {
  const [imports, running] = await Promise.all([
    getActiveBookImports(),
    listRunningImports()
  ]);
  const runningSet = new Set(running);
  return imports.map((imp) => ({
    ...imp,
    imageUrl: imp.imageUrl ? transformImageUrl(imp.imageUrl) : null,
    isActive: runningSet.has(imp.id)
  }));
}

export const activeImportsQueryOptions = queryOptions({
  queryKey: ['active-imports'],
  queryFn: fetchActiveImports
});
