import { sql } from 'kysely';

import { getDb } from '@/iframe/db';

export async function setScenarioDocument(
  scenarioId: string,
  runwayDocumentId: string,
  runwayDocumentHash: string
) {
  return getDb()
    .updateTable('avatarScenarios')
    .set({ runwayDocumentId, runwayDocumentHash, updatedAt: sql`datetime('now')` })
    .where('id', '=', scenarioId)
    .execute();
}

export async function setScenarioScript(
  scenarioId: string,
  startScript: string,
  personality: string
) {
  return getDb()
    .updateTable('avatarScenarios')
    .set({ startScript, personality, updatedAt: sql`datetime('now')` })
    .where('id', '=', scenarioId)
    .execute();
}
