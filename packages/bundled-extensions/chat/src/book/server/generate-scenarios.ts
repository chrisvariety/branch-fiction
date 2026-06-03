import type { BookEntity } from '@branch-fiction/extension-sdk/db';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { ensureDbReady, getDb } from '@/worker/db';
import {
  getBookArcsByBookIdAndTypesAndEntityIds,
  getRelatedBookEntityIdsByEntityId,
  getRelationshipBookArcsByBookIdAndContainingEntityIds
} from '@/worker/db/models/book-arc/get-book-arc';
import { getBookEntityHierarchiesByBookId } from '@/worker/db/models/book-entity-hierarchy/get-book-entity-hierarchy';
import {
  getBookEntitiesByIds,
  getBookEntityById,
  getBookEntityIdsByBookIdAndFriendlyIds
} from '@/worker/db/models/book-entity/get-book-entity';
import { getBookInteractiveEntitiesByInteractiveTypeAndBookIds } from '@/worker/db/models/book-interactive-entity/get-book-interactive-entity';
import { getChapterRelationshipsWithChapterAndEntitiesByBookId } from '@/worker/db/models/chapter-relationship/get-chapter-relationship';
import { createScenarioEntities } from '@/worker/db/models/scenario-entity/create-scenario-entity';
import { createScenario } from '@/worker/db/models/scenario/create-scenario';
import { generateUniqueScenarioFriendlyPrefix } from '@/worker/db/models/scenario/get-scenario';
import { getUserWorldWithEntitiesById } from '@/worker/db/models/user-world/get-user-world';
import { updateUserWorldById } from '@/worker/db/models/user-world/update-user-world';

import {
  findClosestAppellationsForSourceEntity,
  findClosestArcForEntity
} from '../../lib/chat/closest-arc';
import { NewScenario, NewScenarioEntity, UserWorld } from '../../lib/db/types';
import { convertArcFriendlyIdPrefixToIsolated } from '../../lib/lit/arc-types';
import { buildPlaceHierarchy } from '../../lib/lit/hierarchy';
import {
  buildRelationshipGraph,
  findBridgeCharacters
} from '../../lib/lit/relationship-graph';
import { completeOrThrow, getAssistantText } from '../../lib/llm/agent';
import { getText, parse, querySelector, querySelectorAll } from '../../lib/llm/xml';
import generateBridgeScenarioCardsPrompt from '../../lib/prompts/chat/generate-bridge-scenario-cards';
import generateScenarioCardsPrompt from '../../lib/prompts/chat/generate-scenario-cards';
import { getPiModel } from '../../worker/providers';

export type GenerateScenariosParams = {
  userWorldId: string;
  prompt?: string;
};

const TropeCardsSchema = v.object({
  trope_cards: v.array(
    v.object({
      trope_name: v.pipe(
        v.string(),
        v.minLength(1),
        v.description('2-4 word fan-fiction trope title')
      ),
      tags: v.pipe(
        v.array(v.pipe(v.string(), v.minLength(1))),
        v.description('Exactly 3 short mood tags (e.g., "Angst")')
      ),
      hook: v.pipe(
        v.string(),
        v.minLength(1),
        v.description('Single, hard-hitting sentence (18 words or fewer)')
      ),
      character_arc_ids: v.pipe(
        v.array(v.string()),
        v.description('IDs of character arcs used (one per selected character)')
      ),
      appearance_arc_ids: v.pipe(
        v.array(v.pipe(v.string(), v.minLength(1))),
        v.description(
          'One appearance arc ID per character (parallel to character_arc_ids)'
        )
      ),
      relationship_arc_id: v.pipe(
        v.nullish(v.string()),
        v.description('ID of the relationship arc that matches the trope (or null)')
      ),
      location_arc_id: v.pipe(
        v.string(),
        v.description('ID of the location arc providing the setting')
      )
    })
  )
});

export async function generateScenarios({
  userWorldId,
  prompt
}: GenerateScenariosParams) {
  await ensureDbReady();
  const userWorld = await getUserWorldWithEntitiesById(userWorldId);
  if (!userWorld) throw new Error('User world not found');
  if (userWorld.bookInteractiveEntities.length === 0) {
    throw new Error('No book interactive entities found');
  }
  const book = userWorld.books[0];
  if (!book) throw new Error('Book not found');
  const bookEntities = userWorld.bookInteractiveEntities.map((e) => ({
    id: e.bookEntityId,
    imageUrl: e.croppedImageUrl
  }));
  return doGenerateScenarios({
    book: {
      id: book.id,
      title: book.title
    },
    bookEntities,
    userWorldId,
    characterInteractiveType: userWorld.characterInteractiveType,
    placeInteractiveType: userWorld.placeInteractiveType,
    existingScenarioIds: userWorld.scenarioIds,
    userPrompt: prompt
  });
}

async function doGenerateScenarios({
  book,
  bookEntities,
  userWorldId,
  characterInteractiveType,
  placeInteractiveType,
  existingScenarioIds,
  userPrompt
}: {
  book: {
    id: string;
    title: string;
  };
  bookEntities: Array<{
    id: string;
    imageUrl?: string | null;
  }>;
  userWorldId: string;
  characterInteractiveType: UserWorld['characterInteractiveType'];
  placeInteractiveType: UserWorld['placeInteractiveType'];
  existingScenarioIds: string[];
  userPrompt?: string;
}) {
  // Build lookup for entity imageUrls (keyed by bookEntityId)
  // Fetch all interactive entities for the book so bridge/extra characters have images too
  const allInteractiveEntities =
    await getBookInteractiveEntitiesByInteractiveTypeAndBookIds(
      characterInteractiveType,
      [book.id]
    );
  const entityImageUrlMap = new Map(
    allInteractiveEntities.map((e) => [e.bookEntityId, e.croppedImageUrl])
  );

  const { characterEntities, selectedPlace, relationshipArcs } =
    await getScenarioContextData(book.id, bookEntities);

  // Find bridge character if no direct relationship arcs
  let bridgeCharacter: BookEntity | undefined;
  let bridgeRelationshipArcs: Awaited<
    ReturnType<typeof getRelationshipBookArcsByBookIdAndContainingEntityIds>
  > = [];

  if (relationshipArcs.length === 0) {
    const allRelationships = await getChapterRelationshipsWithChapterAndEntitiesByBookId(
      book.id
    );

    const graph = buildRelationshipGraph(allRelationships);
    const selectedCharacterIdsForBridge = characterEntities.map((e) => e.id);
    const bridgeCharacters = findBridgeCharacters(
      graph,
      selectedCharacterIdsForBridge,
      5
    );

    if (bridgeCharacters.length > 0) {
      const allBridgeArcs = await getRelationshipBookArcsByBookIdAndContainingEntityIds(
        book.id,
        bridgeCharacters.map((bc) => bc.id)
      );

      for (const candidate of bridgeCharacters) {
        const characterRelationshipArcs = allBridgeArcs.filter(
          (arc) =>
            arc.type === 'RELATIONSHIP' &&
            arc.bookEntities?.some((e) => e.id === candidate.id)
        );

        if (characterRelationshipArcs.length > 0) {
          const bridgeEntity = await getBookEntityById(candidate.id);
          if (bridgeEntity) {
            bridgeCharacter = bridgeEntity;
            bridgeRelationshipArcs = characterRelationshipArcs;
          }
          break;
        }
      }
    }
  }

  // Combine character entities (including bridge if present)
  const allCharacterEntities = bridgeCharacter
    ? [...characterEntities, bridgeCharacter]
    : characterEntities;
  const selectedCharacterIds = allCharacterEntities.map((e) => e.id);
  const selectedCharacterIdSet = new Set(selectedCharacterIds);

  // Collect entity IDs from relationship arcs that aren't in the selected set.
  // These appear when a relationship arc involves more characters than were selected
  // (e.g. a trio relationship where only two characters were picked).
  const relationshipExtraEntityIds = [
    ...new Set(
      [...relationshipArcs, ...bridgeRelationshipArcs]
        .flatMap((arc) => arc.bookEntityIds)
        .filter((id) => !selectedCharacterIdSet.has(id))
    )
  ];

  // Fetch isolated relationship arcs (needed for saving scenarios)
  const rawRelationshipArcs = await getRelationshipBookArcsByBookIdAndContainingEntityIds(
    book.id,
    selectedCharacterIds
  );
  const isolatedRelationshipArcs = rawRelationshipArcs.filter(
    (arc) => arc.type === 'RELATIONSHIP_ISOLATED'
  );

  // Build rawRelationships for prompt (only when no relationship arcs)
  let rawRelationships: string[] = [];
  if (relationshipArcs.length === 0) {
    const allRelationships = await getChapterRelationshipsWithChapterAndEntitiesByBookId(
      book.id
    );

    rawRelationships = allRelationships
      .filter(
        (rel) =>
          selectedCharacterIds.includes(rel.sourceEntity.id) &&
          selectedCharacterIds.includes(rel.targetEntity.id) &&
          rel.sourceEntity.id !== rel.targetEntity.id
      )
      .map(
        (rel) =>
          `(${rel.sourceEntity.name})-[:${rel.predicateType} {chapter: ${rel.chapter.idx}, description: "${rel.predicateDescription}"}]->(${rel.targetEntity.name})`
      );
  }

  // Build place hierarchy to get all location entity IDs
  const hierarchies = await getBookEntityHierarchiesByBookId(book.id);
  const allPlaceEntityIds = buildPlaceHierarchy(hierarchies, selectedPlace.id);

  // Build entity IDs for arc fetching (include extras from relationship arcs)
  const allEntityIds = [
    ...selectedCharacterIds,
    ...relationshipExtraEntityIds,
    ...allPlaceEntityIds
  ];

  const arcs = await getBookArcsByBookIdAndTypesAndEntityIds(
    book.id,
    [
      'CHARACTER',
      'CHARACTER_ISOLATED',
      'PLACE_ISOLATED',
      'APPEARANCE_ISOLATED',
      'APPELLATION_ISOLATED'
    ],
    allEntityIds,
    { includeChapters: true, includeEntities: true }
  );

  const arcsByType = arcs.reduce<Record<string, typeof arcs>>((acc, arc) => {
    if (!acc[arc.type]) {
      acc[arc.type] = [];
    }
    acc[arc.type].push(arc);
    return acc;
  }, {});

  const locationArcs = arcsByType['PLACE_ISOLATED'] || [];
  if (locationArcs.length === 0) {
    throw new Error(
      `No isolated location arcs found for userWorld ${userWorldId} — PLACE arcs exist but PLACE_ISOLATED versions are missing`
    );
  }
  const appearanceArcs = arcsByType['APPEARANCE_ISOLATED'] || [];
  if (appearanceArcs.length === 0) {
    throw new Error(
      `No isolated appearance arcs found for userWorld ${userWorldId} — APPEARANCE arcs may exist but APPEARANCE_ISOLATED versions are missing`
    );
  }
  const appellationArcs = arcsByType['APPELLATION_ISOLATED'] || [];
  const characterArcs = (arcsByType['CHARACTER'] || [])
    .filter((arc) =>
      // filter out relationshipExtraEntityIds
      arc.bookEntities?.some((e) => selectedCharacterIdSet.has(e.id))
    )
    .sort((a, b) => {
      // Get the entity ID for each arc
      const aEntityId = a.bookEntities?.[0]?.id;
      const bEntityId = b.bookEntities?.[0]?.id;

      // Find position in selected characters (-1 if not found)
      const aSelectedIdx = aEntityId ? selectedCharacterIds.indexOf(aEntityId) : -1;
      const bSelectedIdx = bEntityId ? selectedCharacterIds.indexOf(bEntityId) : -1;

      // Selected characters come first, in their selection order
      if (aSelectedIdx !== -1 && bSelectedIdx === -1) return -1;
      if (aSelectedIdx === -1 && bSelectedIdx !== -1) return 1;
      if (aSelectedIdx !== -1 && bSelectedIdx !== -1 && aSelectedIdx !== bSelectedIdx) {
        return aSelectedIdx - bSelectedIdx;
      }

      // Within same character (or both non-selected), group by friendlyIdPrefix then sort by idx
      if (a.friendlyIdPrefix !== b.friendlyIdPrefix) {
        return a.friendlyIdPrefix.localeCompare(b.friendlyIdPrefix);
      }
      return a.friendlyIdIdx - b.friendlyIdIdx;
    });
  if (characterArcs.length === 0) {
    throw new Error(
      `No character arcs found for userWorld ${userWorldId} — CHARACTER arcs are missing`
    );
  }
  const characterIsolatedArcs = arcsByType['CHARACTER_ISOLATED'] || [];
  if (characterIsolatedArcs.length === 0) {
    throw new Error(
      `No isolated character arcs found for userWorld ${userWorldId} — CHARACTER arcs exist but CHARACTER_ISOLATED versions are missing`
    );
  }

  // Note: Entity references are no longer extracted from arc contents
  const uniqueEntityFriendlyIds: string[] = [];

  let relatedEntities: {
    friendlyId: string;
    name: string;
    description: string | null;
  }[] = [];
  if (uniqueEntityFriendlyIds.length > 0) {
    const entityIdMappings = await getBookEntityIdsByBookIdAndFriendlyIds(
      book.id,
      uniqueEntityFriendlyIds
    );
    const entityIds = entityIdMappings.map((e) => e.id);
    const fullEntities = await getBookEntitiesByIds(entityIds);
    relatedEntities = fullEntities.map((e) => ({
      friendlyId: e.friendlyId,
      name: e.name,
      description: e.description ? e.description : null
    }));
  }

  const formatArcSnapshot = <
    T extends 'characterName' | 'characterNames' | 'locationName'
  >(
    arc: {
      id: string;
      friendlyId: string;
      title: string | null;
      friendlyIdIdx: number;
      startChapterIdx?: number | null;
      endChapterIdx?: number | null;
      content: string;
      bookEntities?: { name: string }[];
    },
    entityNameKey: T
  ) => {
    const entityNames = arc.bookEntities?.map((e) => e.name).join(', ') || '';
    return {
      id: arc.friendlyId,
      [entityNameKey]: entityNames,
      title: arc.title || 'Untitled',
      friendlyIdIdx: arc.friendlyIdIdx,
      chapterRange: `${arc.startChapterIdx ?? '?'}-${arc.endChapterIdx ?? '?'}`,
      content: arc.content
    } as Record<T, string> & {
      id: string;
      title: string;
      friendlyIdIdx: number;
      chapterRange: string;
      content: string;
    };
  };

  // Preserve user-selected character order as much as possible (then append any inferred extras).
  const characterEntityById = new Map(characterEntities.map((e) => [e.id, e]));
  const inputCharacterIds = bookEntities
    .map((e) => e.id)
    .filter((id) => characterEntityById.has(id));
  const inputCharacterIdSet = new Set(inputCharacterIds);
  const orderedCharacterEntities = [
    ...inputCharacterIds
      .map((id) => characterEntityById.get(id))
      .filter((e): e is BookEntity => Boolean(e)),
    ...characterEntities.filter((e) => !inputCharacterIdSet.has(e.id))
  ];

  const player = orderedCharacterEntities[0];
  const others = orderedCharacterEntities.slice(1);
  if (!player) throw new Error('No player character available');

  const basePromptInput = {
    selectedLocation: { id: selectedPlace.friendlyId, name: selectedPlace.name },
    characterArcSnapshots: characterArcs.map((arc) =>
      formatArcSnapshot(arc, 'characterName')
    ),
    appearanceArcSnapshots: appearanceArcs
      .filter((arc) => arc.bookEntities?.some((e) => selectedCharacterIdSet.has(e.id)))
      .map((arc) => formatArcSnapshot(arc, 'characterName')),
    relationshipArcSnapshots: relationshipArcs.map((arc) =>
      formatArcSnapshot(arc, 'characterNames')
    ),
    rawRelationships,
    locationSnapshots: locationArcs.map((arc) => formatArcSnapshot(arc, 'locationName')),
    relatedEntities
  };

  if (bridgeCharacter && others.length < 1) {
    throw new Error('Bridge scenario generation requires at least 2 characters');
  }

  // Bridge mode is strictly 2 core characters + a bridge. If more are present, keep the
  // user's first "other" character and ignore the rest for this generation path.
  const promptText = bridgeCharacter
    ? generateBridgeScenarioCardsPrompt.render({
        ...basePromptInput,
        playerCharacter: {
          id: player.friendlyId,
          name: player.name,
          pronouns: player.pronouns
        },
        otherCharacter: {
          id: others[0].friendlyId,
          name: others[0].name,
          pronouns: others[0].pronouns
        },
        bridgeCharacterName: bridgeCharacter.name,
        bridgeRelationshipArcSnapshots: bridgeRelationshipArcs.map((arc) =>
          formatArcSnapshot(arc, 'characterNames')
        ),
        userPrompt: userPrompt ?? null
      })
    : generateScenarioCardsPrompt.render({
        ...basePromptInput,
        playerCharacter: {
          id: player.friendlyId,
          name: player.name,
          pronouns: player.pronouns
        },
        otherCharacters: others.map((c) => ({
          id: c.friendlyId,
          name: c.name,
          pronouns: c.pronouns
        })),
        firstOtherCharacter: others[0]
          ? {
              id: others[0].friendlyId,
              name: others[0].name,
              pronouns: others[0].pronouns
            }
          : null,
        secondOtherCharacter: others[1]
          ? {
              id: others[1].friendlyId,
              name: others[1].name,
              pronouns: others[1].pronouns
            }
          : null,
        mode: others.length === 0 ? 'solo' : others.length === 1 ? 'dyad' : 'ensemble',
        userPrompt: userPrompt ?? null
      });

  const { model, apiKey, reasoning } = getPiModel('text');
  const messages = [
    {
      role: 'user' as const,
      content: promptText,
      timestamp: Date.now()
    }
  ];

  const message = await completeOrThrow(
    model,
    { messages },
    { apiKey, reasoning, sessionId: uuidv7() }
  );

  const xml = getAssistantText(message);
  const ast = parse(xml);
  const tropeCardEls = querySelectorAll(ast, 'trope_cards > trope_card');
  const tropeCards = v.parse(TropeCardsSchema, {
    trope_cards: tropeCardEls.map((el) => {
      const relationshipEl = querySelector(el, 'relationship_arc_id');
      return {
        trope_name: getText(querySelector(el, 'trope_name')),
        tags: querySelectorAll(el, 'tags > tag').map((t) => getText(t)),
        hook: getText(querySelector(el, 'hook')),
        character_arc_ids: querySelectorAll(
          el,
          'character_arc_ids > character_arc_id'
        ).map((n) => getText(n)),
        appearance_arc_ids: querySelectorAll(
          el,
          'appearance_arc_ids > appearance_arc_id'
        ).map((n) => getText(n)),
        relationship_arc_id: relationshipEl ? getText(relationshipEl) || null : null,
        location_arc_id: getText(querySelector(el, 'location_arc_id'))
      };
    })
  }).trope_cards;

  const scenarios: (Omit<
    NewScenario,
    'friendlyId' | 'friendlyIdPrefix' | 'friendlyIdIdx'
  > & {
    entities: Omit<NewScenarioEntity, 'scenarioId'>[];
  })[] = [];

  const characterArcMap = new Map(
    (arcsByType['CHARACTER'] || []).map((arc) => [arc.friendlyId, arc])
  );
  const relationshipArcMap = new Map(
    relationshipArcs.map((arc) => [arc.friendlyId, arc])
  );
  const locationArcMap = new Map(locationArcs.map((arc) => [arc.friendlyId, arc]));
  const isolatedCharacterArcMap = new Map(
    characterIsolatedArcs.map((arc) => [arc.friendlyId, arc])
  );
  const isolatedRelationshipArcMap = new Map(
    isolatedRelationshipArcs.map((arc) => [arc.friendlyId, arc])
  );
  const appearanceArcMap = new Map(appearanceArcs.map((arc) => [arc.friendlyId, arc]));

  for (const card of tropeCards) {
    console.log('TROPE_CARD', card);
    const description = card.hook;

    // Note: Entity references are no longer extracted from descriptions
    const entityFriendlyIds: string[] = [];

    // Look up real entity IDs from friendly IDs
    const additionalEntities =
      entityFriendlyIds.length > 0
        ? await getBookEntityIdsByBookIdAndFriendlyIds(book.id, entityFriendlyIds)
        : [];
    const additionalBookEntityIds = additionalEntities.map((e) => e.id);

    // Find relationship arc (if provided)
    let relationshipArc: (typeof relationshipArcs)[number] | undefined;
    if (
      card.relationship_arc_id &&
      card.relationship_arc_id !== '' &&
      card.relationship_arc_id !== 'null' // sometimes the LLM likes to provide null as a string
    ) {
      relationshipArc = relationshipArcMap.get(card.relationship_arc_id);

      if (!relationshipArc) {
        console.error(`Relationship arc not found: ${card.relationship_arc_id}`);
      }
    }

    // Collect character IDs for appellation lookup
    const scenarioCharacterIds = card.character_arc_ids.flatMap((arcId) => {
      const arc = characterArcMap.get(arcId);
      return arc?.bookEntities?.map((e) => e.id) || [];
    });
    const scenarioCharacterIdSet = new Set(scenarioCharacterIds);

    // Include extra entities from the chosen relationship arc
    // (e.g. a trio relationship where only two characters were selected)
    const extraCharacterArcFriendlyIds: string[] = [];
    if (relationshipArc) {
      const allCharacterArcsForLookup = arcsByType['CHARACTER'] || [];
      const relChapterRange = {
        start: relationshipArc.startChapterIdx,
        end: relationshipArc.endChapterIdx
      };
      for (const entityId of relationshipArc.bookEntityIds) {
        if (!scenarioCharacterIdSet.has(entityId)) {
          scenarioCharacterIds.push(entityId);
          scenarioCharacterIdSet.add(entityId);
          const closestArcDbId = findClosestArcForEntity(
            entityId,
            relChapterRange,
            allCharacterArcsForLookup
          );
          if (closestArcDbId) {
            const closestArc = allCharacterArcsForLookup.find(
              (a) => a.id === closestArcDbId
            );
            if (closestArc) {
              extraCharacterArcFriendlyIds.push(closestArc.friendlyId);
            }
          }
        }
      }
    }

    // Map character arc friendly ID → LLM-selected appearance arc friendly ID
    const characterAppearanceMap = new Map(
      card.character_arc_ids.map((charArcId, i) => [
        charArcId,
        card.appearance_arc_ids[i]
      ])
    );

    // Build scenario entities first (need appellations before creating scenario)
    const appellationBookArcIds: string[] = [];
    const pendingEntities: Omit<NewScenarioEntity, 'scenarioId'>[] = [];
    let entityIdx = 0;
    const allArcIds = [
      ...card.character_arc_ids,
      ...extraCharacterArcFriendlyIds,
      card.location_arc_id
    ];

    for (const arcId of allArcIds) {
      let arc = characterArcMap.get(arcId);

      let type;
      if (arc) {
        type = 'CHARACTER' as const;
      } else {
        // place arcs are already isolated
        arc = locationArcMap.get(arcId);
        type = 'LOCATION' as const;
      }
      if (arc) {
        const entities = arc.bookEntities || [];
        const arcChapterRange = {
          start: arc.startChapterIdx,
          end: arc.endChapterIdx
        };

        for (const entity of entities) {
          // Use LLM-selected appearance for character arcs, fallback for extras/locations
          const llmAppearanceId = characterAppearanceMap.get(arcId);
          const llmAppearanceArc = llmAppearanceId
            ? appearanceArcMap.get(llmAppearanceId)
            : null;
          const appearanceBookArcId =
            llmAppearanceArc?.id ??
            findClosestArcForEntity(entity.id, arcChapterRange, appearanceArcs);

          if (!appearanceBookArcId) {
            console.error(
              `!! No appearance arc found for entity ${entity.id} (${entity.name})`
            );
          }

          // Find closest appellations where this character is the source
          if (type === 'CHARACTER') {
            const entityAppellations = findClosestAppellationsForSourceEntity(
              entity.id,
              scenarioCharacterIdSet,
              arcChapterRange,
              appellationArcs
            );
            appellationBookArcIds.push(...entityAppellations);
          }

          pendingEntities.push({
            id: uuidv7(),
            idx: entityIdx++,
            bookId: book.id,
            bookEntityId: entity.id,
            bookArcId:
              type === 'CHARACTER' // save the ISOLATED character arc
                ? isolatedCharacterArcMap.get(
                    `${convertArcFriendlyIdPrefixToIsolated(arc.friendlyIdPrefix)}${arc.friendlyIdIdx}`
                  )?.id || arc.id
                : arc.id,
            imageUrl: entityImageUrlMap.get(entity.id)!,
            appearanceBookArcId
          });
        }
      } else {
        console.error(`!! No arc found (arc ID: ${arcId})`);
      }
    }

    // Add any remaining book entities not covered by LLM-selected arcs
    // this ensures when the user selects a trio, a trio actually ends up in their chat,
    // even if the scenario only involves two characters - the third can still be 'in the room'
    const coveredEntityIds = new Set(pendingEntities.map((e) => e.bookEntityId));
    const playerArc = characterArcMap.get(card.character_arc_ids[0]);
    const referenceChapterRange = playerArc
      ? { start: playerArc.startChapterIdx, end: playerArc.endChapterIdx }
      : {};

    for (const inputEntity of bookEntities) {
      if (coveredEntityIds.has(inputEntity.id)) continue;
      if (!selectedCharacterIdSet.has(inputEntity.id)) continue;

      const closestCharacterArcId = findClosestArcForEntity(
        inputEntity.id,
        referenceChapterRange,
        characterIsolatedArcs
      );
      if (!closestCharacterArcId) continue;

      const closestAppearanceArcId = findClosestArcForEntity(
        inputEntity.id,
        referenceChapterRange,
        appearanceArcs
      );

      scenarioCharacterIdSet.add(inputEntity.id);
      const entityAppellations = findClosestAppellationsForSourceEntity(
        inputEntity.id,
        scenarioCharacterIdSet,
        referenceChapterRange,
        appellationArcs
      );
      appellationBookArcIds.push(...entityAppellations);

      pendingEntities.push({
        id: uuidv7(),
        idx: entityIdx++,
        bookId: book.id,
        bookEntityId: inputEntity.id,
        bookArcId: closestCharacterArcId,
        imageUrl: entityImageUrlMap.get(inputEntity.id)!,
        appearanceBookArcId: closestAppearanceArcId
      });
    }

    scenarios.push({
      id: uuidv7(),
      bookId: book.id,
      relationshipBookArcId: relationshipArc
        ? // save the ISOLATED version of the relationship
          isolatedRelationshipArcMap.get(
            `${convertArcFriendlyIdPrefixToIsolated(relationshipArc.friendlyIdPrefix)}${relationshipArc.friendlyIdIdx}`
          )?.id || relationshipArc.id
        : undefined,
      title: card.trope_name,
      description,
      toneTags: card.tags,
      appellationBookArcIds,
      additionalBookEntityIds,
      characterInteractiveType,
      placeInteractiveType,
      entities: pendingEntities
    });
  }

  if (scenarios.length === 0) {
    throw new Error('No scenarios generated');
  }

  const createdScenarios = await getDb()
    .transaction()
    .execute(async (trx) => {
      const createdScenarios = [];
      for (const scenario of scenarios) {
        const { entities, ...restScenario } = scenario;
        const scenarioEntityIds = entities.map((e) => e.bookEntityId);
        const friendlyIdPrefix = await generateUniqueScenarioFriendlyPrefix({
          bookId: book.id,
          entityIds: scenarioEntityIds,
          trx
        });

        const createdScenario = await createScenario(restScenario, friendlyIdPrefix, trx);

        if (createdScenario) {
          createdScenarios.push(createdScenario);
          await createScenarioEntities(
            scenario.entities.map((entity) => ({
              ...entity,
              scenarioId: createdScenario.id
            })),
            trx
          );
        }
      }
      return createdScenarios;
    });

  // Append new scenario IDs to user world (preserving existing ones)
  if (createdScenarios.length > 0) {
    await updateUserWorldById(userWorldId, {
      scenarioIds: [...existingScenarioIds, ...createdScenarios.map(({ id }) => id)]
    });
  }

  return {
    scenarios: createdScenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      description: scenario.description
    }))
  };
}

/**
 * Retrieves context data for scenario generation including characters,
 * selected location, and relationship arcs.
 */
async function getScenarioContextData(
  bookId: string,
  bookEntityInputs: Array<{ id: string; arcId?: string }>
) {
  const bookEntities = await getBookEntitiesByIds(bookEntityInputs.map(({ id }) => id));

  // Find the selected place (must be exactly one)
  const inputPlaceEntities = bookEntities.filter((e) => e.type === 'PLACE');
  if (inputPlaceEntities.length === 0) {
    throw new Error('No place entity found in selection');
  }
  if (inputPlaceEntities.length > 1) {
    throw new Error(
      'Multiple place entities found in selection. Only one place is allowed.'
    );
  }
  const selectedPlace = inputPlaceEntities[0];

  // Extract character entities and IDs
  const characterEntities: BookEntity[] = bookEntities.filter(
    (e) => e.type === 'CHARACTER'
  );
  let selectedCharacterIds = characterEntities.map((e) => e.id);

  if (selectedCharacterIds.length === 0) {
    throw new Error('No character entities found in selection');
  }

  // If only one character, find related characters via RELATIONSHIP arcs
  if (selectedCharacterIds.length === 1) {
    const otherBookArcEntities = await getRelatedBookEntityIdsByEntityId(
      bookId,
      'RELATIONSHIP',
      selectedCharacterIds[0]
    );

    const topRelatedCharacters = otherBookArcEntities
      .sort((a, b) => b.count - a.count)
      .slice(0, 2)
      .map((entity) => entity.bookEntityId);

    selectedCharacterIds = Array.from(
      new Set([...selectedCharacterIds, ...topRelatedCharacters])
    );

    // Fetch the newly added character entities
    if (topRelatedCharacters.length > 0) {
      const additionalCharacters = await getBookEntitiesByIds(topRelatedCharacters);
      characterEntities.push(...additionalCharacters);
    }
  }

  // Get relationship arcs
  const rawRelationshipArcs = await getRelationshipBookArcsByBookIdAndContainingEntityIds(
    bookId,
    selectedCharacterIds
  );

  const relationshipArcs = rawRelationshipArcs.filter(
    (arc) => arc.type === 'RELATIONSHIP'
  );

  return {
    characterEntities,
    selectedPlace,
    relationshipArcs
  };
}
