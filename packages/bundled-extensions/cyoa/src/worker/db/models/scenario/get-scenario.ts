import { sql } from 'kysely';

import { env } from '../../../../env/server';
import type { Scenario, Transaction } from '../../../../lib/db/types';
import { generateUniqueFriendlyPrefix } from '../../../../lib/lit/friendly-id';
import { jsonArrayFrom } from '../../dialect';
import { getDb } from '../../index';
import { getBookEntityNamesByIds } from '../book-entity/get-book-entity';

export async function getScenarioById(id: Scenario['id']) {
  return getDb()
    .selectFrom('scenarios')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function getScenarioTitlesAndDescriptionsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const scenarios = await getDb()
    .selectFrom('scenarios')
    .select(['id', 'title', 'description'])
    .where('id', 'in', ids)
    .execute();

  const scenarioMap = new Map(scenarios.map((s) => [s.id, s]));

  return ids.flatMap((id) => scenarioMap.get(id) ?? []);
}

export async function getScenarioWithEntitiesById(id: Scenario['id']) {
  return getDb()
    .selectFrom('scenarios')
    .selectAll()
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('scenarioEntities')
          .select([
            'scenarioEntities.idx',
            'scenarioEntities.bookId',
            'scenarioEntities.bookEntityId',
            'scenarioEntities.bookArcId',
            'scenarioEntities.appearanceBookArcId',
            'scenarioEntities.imageUrl'
          ])
          .whereRef('scenarioEntities.scenarioId', '=', 'scenarios.id')
      ).as('scenarioEntities')
    ])
    .where('id', '=', id)
    .executeTakeFirst();
}

/**
 * Generate a unique friendly prefix for a scenario,
 * handling collisions by progressively expanding initials.
 *
 * @returns The friendly ID prefix (e.g., "S-VXD-")
 */
export async function generateUniqueScenarioFriendlyPrefix({
  bookId,
  entityIds,
  trx
}: {
  bookId: string;
  entityIds: string[];
  trx?: Transaction;
}): Promise<string> {
  const db = trx || getDb();

  const entities = await getBookEntityNamesByIds(entityIds, trx);
  const typePrefix = 'S';
  const sortedEntityIds = [...entityIds].sort();

  const checkCollision = async (prefix: string): Promise<boolean> => {
    const existingScenarios = await db
      .selectFrom('scenarios')
      .innerJoin('scenarioEntities', 'scenarios.id', 'scenarioEntities.scenarioId')
      .select(['scenarios.id as scenarioId'])
      .select(() =>
        env.DATABASE_DIALECT === 'sqlite'
          ? sql<string[]>`json_group_array(scenario_entities.book_entity_id)`.as(
              'bookEntityIds'
            )
          : sql<string[]>`array_agg(scenario_entities.book_entity_id)`.as('bookEntityIds')
      )
      .where('scenarios.bookId', '=', bookId)
      .where('scenarios.friendlyIdPrefix', '=', prefix)
      .groupBy('scenarios.id')
      .execute();

    // Check if any existing scenario has a different entity set
    for (const scenario of existingScenarios) {
      const sortedExisting = [...scenario.bookEntityIds].sort();
      // If entity sets are different, we have a collision
      if (JSON.stringify(sortedEntityIds) !== JSON.stringify(sortedExisting)) {
        return true;
      }
    }

    return false;
  };

  return generateUniqueFriendlyPrefix({
    typePrefix,
    entities,
    checkCollision
  });
}
