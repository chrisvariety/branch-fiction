import { v7 as uuidv7 } from 'uuid';

import { getDb } from '../../index';

export interface ScenarioInput {
  scenarioKey: string;
  mode: string;
  label: string;
  tagline: string;
  startScript: string;
  personality: string;
  knowledge: string;
  knowledgeHash: string;
  anchorChapterIdx: number | null;
  sortOrder: number;
}

// Replace a character's scenarios, reusing the Runway document id when knowledge is unchanged.
export async function replaceScenarios(
  bookId: string,
  characterId: string,
  scenarios: ScenarioInput[]
): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('avatarScenarios')
      .select(['scenarioKey', 'knowledgeHash', 'runwayDocumentId', 'runwayDocumentHash'])
      .where('bookId', '=', bookId)
      .where('characterId', '=', characterId)
      .execute();
    const byKey = new Map(existing.map((e) => [e.scenarioKey, e]));

    await trx
      .deleteFrom('avatarScenarios')
      .where('bookId', '=', bookId)
      .where('characterId', '=', characterId)
      .execute();

    if (scenarios.length === 0) return;

    await trx
      .insertInto('avatarScenarios')
      .values(
        scenarios.map((s) => {
          const prior = byKey.get(s.scenarioKey);
          const reuseDoc = prior && prior.knowledgeHash === s.knowledgeHash;
          return {
            id: uuidv7(),
            bookId,
            characterId,
            scenarioKey: s.scenarioKey,
            mode: s.mode,
            label: s.label,
            tagline: s.tagline,
            startScript: s.startScript,
            personality: s.personality,
            knowledge: s.knowledge,
            knowledgeHash: s.knowledgeHash,
            anchorChapterIdx: s.anchorChapterIdx,
            runwayDocumentId: reuseDoc ? prior.runwayDocumentId : null,
            runwayDocumentHash: reuseDoc ? prior.runwayDocumentHash : null,
            sortOrder: s.sortOrder
          };
        })
      )
      .execute();
  });
}
