import { sql } from 'kysely';

import type { FirstLaunchStep, LogLine, Transaction } from '@/lib/db/types';

import { getDb } from '../../index';

export async function markFirstLaunchStepRunning(
  id: FirstLaunchStep['id'],
  trx?: Transaction
): Promise<void> {
  await (trx || getDb())
    .updateTable('firstLaunchSteps')
    .set({
      startedAt: sql`datetime('now')`,
      completedAt: null,
      lastError: null,
      attemptCount: sql`attempt_count + 1`,
      updatedAt: sql`datetime('now')`
    })
    .where('id', '=', id)
    .execute();
}

export async function markFirstLaunchStepDone(
  id: FirstLaunchStep['id'],
  trx?: Transaction
): Promise<void> {
  await (trx || getDb())
    .updateTable('firstLaunchSteps')
    .set({
      completedAt: sql`datetime('now')`,
      lastError: null,
      updatedAt: sql`datetime('now')`
    })
    .where('id', '=', id)
    .execute();
}

export async function markFirstLaunchStepError(
  id: FirstLaunchStep['id'],
  message: string,
  trx?: Transaction
): Promise<void> {
  await (trx || getDb())
    .updateTable('firstLaunchSteps')
    .set({
      completedAt: sql`datetime('now')`,
      lastError: message,
      updatedAt: sql`datetime('now')`
    })
    .where('id', '=', id)
    .execute();
}

export async function appendFirstLaunchStepLog(
  id: FirstLaunchStep['id'],
  line: LogLine,
  trx?: Transaction
): Promise<void> {
  await (trx || getDb())
    .updateTable('firstLaunchSteps')
    .set({
      logs: sql`json_insert(COALESCE(logs, '[]'), '$[#]', json(${JSON.stringify(line)}))`,
      updatedAt: sql`datetime('now')`
    })
    .where('id', '=', id)
    .execute();
}
