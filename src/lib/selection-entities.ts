import { invoke } from '@tauri-apps/api/core';

export type SelectionEntityType = 'CHARACTER' | 'PLACE';

export interface SelectionEntityRow {
  id: string;
  name: string;
  description: string | null;
  significanceTier: 'PRIMARY' | 'SECONDARY' | null;
  significanceRank: number | null;
  aliases: string[];
  pronouns: string | null;
  label: string | null;
  minorStatus: 'NEVER' | 'THROUGHOUT' | 'UNTIL_CHAPTER';
}

export interface SelectionChange {
  id: string;
  significanceTier: 'PRIMARY' | 'SECONDARY';
  significanceRank: number;
}

// Selection lives in the per-import pipeline DB; routed via Tauri commands keyed by bookImportId.
export function readSelectionEntities(
  bookImportId: string,
  bookId: string,
  type: SelectionEntityType
): Promise<SelectionEntityRow[]> {
  return invoke('read_selection_entities', { bookImportId, bookId, entityType: type });
}

export function updateSelectionEntities(
  bookImportId: string,
  changes: SelectionChange[]
): Promise<void> {
  return invoke('update_selection_entities', { bookImportId, changes });
}
