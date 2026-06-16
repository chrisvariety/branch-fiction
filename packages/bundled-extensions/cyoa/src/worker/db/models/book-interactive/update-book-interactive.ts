import type { BookInteractive, Transaction } from '@/lib/db/types';

/**
 * Promotes a draft interactive to active and archives the previous active one.
 * Must be called within a transaction to maintain the partial unique index invariant
 * (only one active per book+type).
 */
export async function promoteBookInteractive(
  bookId: BookInteractive['bookId'],
  type: BookInteractive['type'],
  promoteId: BookInteractive['id'],
  trx: Transaction
) {
  // Archive the current active interactive (if any)
  await trx
    .updateTable('bookInteractives')
    .set({ status: 'archived' })
    .where('bookId', '=', bookId)
    .where('type', '=', type)
    .where('status', '=', 'active')
    .execute();

  // Promote the draft to active
  await trx
    .updateTable('bookInteractives')
    .set({ status: 'active' })
    .where('id', '=', promoteId)
    .execute();
}
