import { sql } from 'kysely';

import type { NarrativeLine, PipelineStepUpdate, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function updatePipelineStepById(
  id: string,
  step: PipelineStepUpdate,
  trx?: Transaction
) {
  return (trx || getDb())
    .updateTable('pipelineSteps')
    .set({
      ...step,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
}

// Upsert a narrative line keyed by line.id: update if present, append otherwise.
export async function upsertPipelineStepNarrativeLine(
  id: string,
  line: NarrativeLine,
  trx?: Transaction
) {
  const db = trx || getDb();
  const row = await db
    .selectFrom('pipelineSteps')
    .select('narrative')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) return;
  const existing = (row.narrative ?? []) as NarrativeLine[];
  const idx = existing.findIndex((l) => l.id === line.id);
  const next =
    idx === -1 ? [...existing, line] : existing.map((l, i) => (i === idx ? line : l));
  await db
    .updateTable('pipelineSteps')
    .set({
      narrative: next,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where('id', '=', id)
    .execute();
}
