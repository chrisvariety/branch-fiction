import { sql } from 'kysely';

import type {
  LogLine,
  NarrativeLine,
  PipelineStepUpdate,
  Transaction
} from '@/app/lib/db/types';

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

// Flip the given parent steps back to 'pending' (clearing run state) so a phase
// re-runs. Fan-out child rows are left as-is on purpose: the re-run re-enumerates
// and skips children that already completed, doing work only for new items.
export async function resetParentPipelineStepsToPending(
  bookImportId: string,
  stepIds: string[],
  trx?: Transaction
) {
  if (stepIds.length === 0) return;
  await (trx || getDb())
    .updateTable('pipelineSteps')
    .set({
      status: 'pending',
      startedAt: null,
      completedAt: null,
      lastError: null,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where('bookImportId', '=', bookImportId)
    .where('stepId', 'in', stepIds)
    .where('fanOutKey', 'is', null)
    .execute();
}

export async function appendPipelineStepNarrativeLine(
  id: string,
  line: NarrativeLine,
  trx?: Transaction
) {
  await (trx || getDb())
    .updateTable('pipelineSteps')
    .set({
      narrative: sql`json_insert(COALESCE(narrative, '[]'), '$[#]', json(${JSON.stringify(line)}))`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where('id', '=', id)
    .execute();
}

export async function appendPipelineStepLog(
  id: string,
  line: LogLine,
  trx?: Transaction
) {
  await (trx || getDb())
    .updateTable('pipelineSteps')
    .set({
      logs: sql`json_insert(COALESCE(logs, '[]'), '$[#]', json(${JSON.stringify(line)}))`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    })
    .where('id', '=', id)
    .execute();
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
