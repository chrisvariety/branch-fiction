import { queryOptions } from '@tanstack/react-query';

import {
  readSelectionEntities,
  type SelectionEntityRow,
  type SelectionEntityType
} from '@/lib/selection-entities';

export type EntitySelectionType = SelectionEntityType;

export function entitySelectionQueryOptions(
  bookImportId: string,
  bookId: string,
  type: EntitySelectionType
) {
  return queryOptions({
    queryKey: ['entity-selection', bookImportId, bookId, type] as const,
    queryFn: () => readSelectionEntities(bookImportId, bookId, type)
  });
}

export type SelectionEntity = SelectionEntityRow;
