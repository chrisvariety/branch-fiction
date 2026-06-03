import type { Slot } from '@branch-fiction/extension-sdk';
import { sql } from 'kysely';

import { DEFAULT_ORG_ID } from '@/lib/auth';
import type { Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

// Global default text-model; snapshotted onto imports and used by `useSlot` extensions.
export async function getOrganizationTextModel(trx?: Transaction) {
  return (trx || getDb())
    .selectFrom('organizationTextModels')
    .selectAll()
    .where('organizationId', '=', DEFAULT_ORG_ID)
    .executeTakeFirst();
}

// The provider_model id chosen for a given text role, if any.
export async function getDefaultTextModelId(
  slot: Slot,
  trx?: Transaction
): Promise<string | null> {
  const row = await getOrganizationTextModel(trx);
  if (!row) return null;
  return slot === 'piTextLight' ? row.textLightProviderModelId : row.textProviderModelId;
}

// Set the org default text + light models (the import step writes the same id to both).
export async function setOrganizationTextModel(
  args: {
    textProviderModelId: string | null;
    textLightProviderModelId: string | null;
  },
  trx?: Transaction
): Promise<void> {
  await (trx || getDb())
    .insertInto('organizationTextModels')
    .values({
      organizationId: DEFAULT_ORG_ID,
      textProviderModelId: args.textProviderModelId,
      textLightProviderModelId: args.textLightProviderModelId
    })
    .onConflict((oc) =>
      oc.column('organizationId').doUpdateSet({
        textProviderModelId: args.textProviderModelId,
        textLightProviderModelId: args.textLightProviderModelId,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
    )
    .execute();
}
