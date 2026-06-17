import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';

const RELATIONSHIP_SESSION_NAMESPACE = '9b7d2e4a-3c5f-4a1d-b2e9-c4f6a8d1e3b5';

import { watchAgent } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';

import { bridgeUpdateBookImport } from '@/lib/bridge';
import { getBookCategoriesByBookId } from '@/lib/db/models/book-category/get-book-category';
import {
  getBookEntitiesByBookIdAndNotTypes,
  getBookEntitiesByBookIdAndTypes
} from '@/lib/db/models/book-entity/get-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getBookEntityIdsFromChaptersAppellations } from '@/lib/db/models/chapter-entity-appellation/get-chapter-entity-appellation';
import { getNonEmptyChapterParagraphsByChapterIds } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { createChapterRelationships } from '@/lib/db/models/chapter-relationship/create-chapter-relationship';
import { getChapterSceneGroupById } from '@/lib/db/models/chapter-scene-group/get-chapter-scene-group';
import { getChapterScenesWithSettingAndLocationByIds } from '@/lib/db/models/chapter-scene/get-chapter-scene';
import { fuzzyMatchByKey } from '@/lib/lit/fuzzy-match';
import { gatherMentions } from '@/lib/lit/gather-mentions';
import { entityNamesFormatted } from '@/lib/lit/names';
import { organizeParagraphsIntoScenes } from '@/lib/lit/organize-paragraphs-into-scenes';
import { buildSceneAttrs } from '@/lib/lit/scene-attrs';
import extractRelationshipsCharacterPhase from '@/lib/prompts/import/extract-relationships-from-chapter-intro';
import extractRelationshipsOtherPhase from '@/lib/prompts/import/extract-relationships-from-chapter-other';
import extractRelationshipsPlacePhase from '@/lib/prompts/import/extract-relationships-from-chapter-place';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

export const handler = createWorkflowFunction<
  {
    sceneGroupId: string;
    bookImportId: string;
  },
  {
    sceneGroup: NonNullable<Awaited<ReturnType<typeof getChapterSceneGroupById>>>;
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookImport: NonNullable<Awaited<ReturnType<typeof getBookImportById>>>;
  }
>(
  {
    name: ({ sceneGroup }, retryCount) =>
      `Relationships Group ${sceneGroup.idx}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ sceneGroupId, bookImportId }) => {
      const sceneGroup = await getChapterSceneGroupById(sceneGroupId);
      const bookImport = await getBookImportById(bookImportId);
      if (!sceneGroup || !bookImport)
        throw new UnrecoverableError('Scene Group or Book Import not found');
      const book = await getBookById(sceneGroup.bookId);
      if (!book) throw new UnrecoverableError('Book not found');
      return { sceneGroup, book, bookImport };
    },
    onFailure: async (_, error) => {
      await bridgeUpdateBookImport({
        status: error instanceof UnrecoverableError ? 'failed' : 'pending',
        lastError: error.message,
        incrementErrorCount: true
      });
    }
  },
  async ({ sceneGroup }, ctx) => {
    ctx.log
      .withMetadata({
        sceneGroupId: sceneGroup.id,
        sceneGroupIdx: sceneGroup.idx
      })
      .info('Starting relationship extraction');

    const allCharacters = await getBookEntitiesByBookIdAndTypes(sceneGroup.bookId, [
      'CHARACTER'
    ]);
    const allPlaces = await getBookEntitiesByBookIdAndTypes(sceneGroup.bookId, ['PLACE']);
    const allOthers = await getBookEntitiesByBookIdAndNotTypes(sceneGroup.bookId, [
      'CHARACTER',
      'PLACE'
    ]);
    const allCategories = await getBookCategoriesByBookId(sceneGroup.bookId);
    const otherCategories = allCategories.filter(
      (c) => c.type !== 'CHARACTER' && c.type !== 'PLACE'
    );

    const scenes = await getChapterScenesWithSettingAndLocationByIds(
      sceneGroup.chapterSceneIds
    );

    const chapterIds = [...new Set(scenes.map((s) => s.chapterId))];
    const paragraphs = await getNonEmptyChapterParagraphsByChapterIds(chapterIds);

    const scenesWithParagraphs = organizeParagraphsIntoScenes(scenes, paragraphs);

    const allText = paragraphs.map((paragraph) => paragraph.content).join('\n');
    const povCharacterIds = Array.from(
      new Set(scenes.flatMap((scene) => scene.povBookEntityId ?? []))
    );

    // Characters: mentioned + appellation-resolved
    const mentionedCharacters = gatherMentions(allText, allCharacters, povCharacterIds);
    const mentionedCharacterIds = new Set(Array.from(mentionedCharacters, (e) => e.id));
    const appellationCharacterIds = await getBookEntityIdsFromChaptersAppellations(
      chapterIds,
      allCharacters.map((e) => e.id)
    );
    const charactersForPass = Array.from(mentionedCharacters).concat(
      allCharacters
        .filter(
          (e) =>
            appellationCharacterIds.includes(e.id) && !mentionedCharacterIds.has(e.id)
        )
        .map((e) => ({ ...e, mentionCount: 1, phrasesMentioned: [] }))
    );

    // Places: include ALL places (matching prior PLACE-pass behavior)
    const placesForPass = allPlaces.map((e) => ({
      ...e,
      mentionCount: 1,
      phrasesMentioned: []
    }));

    // Others: mentioned + appellation-resolved
    const mentionedOthers = gatherMentions(allText, allOthers, []);
    const mentionedOtherIds = new Set(Array.from(mentionedOthers, (e) => e.id));
    const appellationOtherIds = await getBookEntityIdsFromChaptersAppellations(
      chapterIds,
      allOthers.map((e) => e.id)
    );
    const othersForPass = Array.from(mentionedOthers).concat(
      allOthers
        .filter((e) => appellationOtherIds.includes(e.id) && !mentionedOtherIds.has(e.id))
        .map((e) => ({ ...e, mentionCount: 1, phrasesMentioned: [] }))
    );

    const totalEntities =
      charactersForPass.length + placesForPass.length + othersForPass.length;
    if (totalEntities === 0) {
      ctx.log
        .withMetadata({
          sceneGroupId: sceneGroup.id,
          sceneGroupIdx: sceneGroup.idx
        })
        .info('Skipping relationship extraction - no entities mentioned');

      return Response.json({
        sceneGroupId: sceneGroup.id,
        relationshipsCount: 0
      });
    }

    const extractedRelationships = await runExtractionAgent(
      {
        characters: charactersForPass,
        places: placesForPass,
        others: othersForPass,
        categories: otherCategories,
        scenes: scenesWithParagraphs.map((scene) => ({
          pov: scene.pov,
          povEntity: scene.povEntity,
          paragraphs: scene.paragraphs,
          location: scene.location,
          setting: scene.setting
        })),
        sessionId: uuidv5(sceneGroup.id, RELATIONSHIP_SESSION_NAMESPACE)
      },
      ctx
    );

    const allEntitiesForPass = [...charactersForPass, ...placesForPass, ...othersForPass];
    const entityByFriendlyId = new Map(allEntitiesForPass.map((e) => [e.friendlyId, e]));

    const toInsert = extractedRelationships.flatMap((r) => {
      const src = entityByFriendlyId.get(r.source_id);
      const tgt = entityByFriendlyId.get(r.target_id);
      if (!src || !tgt) {
        ctx.log.warn(
          `Skipping relationship with unknown entity after extraction: ${r.source_id} -> ${r.target_id}`
        );
        return [];
      }
      return [
        {
          id: uuidv7(),
          bookId: sceneGroup.bookId,
          chapterId: sceneGroup.startChapterId,
          sourceBookEntityId: src.id,
          predicateType: r.predicate_type,
          predicateDescription: r.predicate_description,
          targetBookEntityId: tgt.id
        }
      ];
    });

    const CHUNK_SIZE = 1000;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      await createChapterRelationships(toInsert.slice(i, i + CHUNK_SIZE));
    }

    return Response.json({
      sceneGroupId: sceneGroup.id,
      relationshipsCount: toInsert.length
    });
  }
);

const AddRelationshipSchema = Type.Object({
  source_id: Type.String({
    description:
      'The id of the source entity (subject of the relationship). Must exactly match an id from the currently-available <named_entities> list.'
  }),
  target_id: Type.String({
    description:
      'The id of the target entity (object of the relationship). Must exactly match an id from the currently-available <named_entities> list. Must be different from source_id.'
  }),
  predicate_type: Type.String({
    description:
      'The relationship type in UPPERCASE_SNAKE_CASE (e.g. ATTACKS, IS_LOCATED_IN, WIELDS).'
  }),
  predicate_description: Type.String({
    description:
      'A concise one-sentence justification for the relationship, ideally with a short illustrative quote from the text.'
  })
});

async function runExtractionAgent(
  {
    characters,
    places,
    others,
    categories,
    scenes,
    sessionId
  }: {
    characters: Awaited<ReturnType<typeof getBookEntitiesByBookIdAndTypes>>;
    places: Awaited<ReturnType<typeof getBookEntitiesByBookIdAndTypes>>;
    others: Awaited<ReturnType<typeof getBookEntitiesByBookIdAndTypes>>;
    categories: Awaited<ReturnType<typeof getBookCategoriesByBookId>>;
    scenes: Array<{
      pov: string;
      povEntity: string;
      paragraphs: { content: string }[];
      location: string | null;
      setting: string | null;
    }>;
    sessionId: string;
  },
  ctx: WorkflowContext
) {
  type Relationship = {
    source_id: string;
    target_id: string;
    predicate_type: string;
    predicate_description: string;
  };
  type AllowedEntity = (typeof characters)[number];

  const relationships: Relationship[] = [];
  const seen = new Set<string>();
  const allowedById = new Map<string, AllowedEntity>();

  const addRelationshipTool: AgentTool<typeof AddRelationshipSchema> = {
    name: 'add_relationship',
    label: 'Add Relationship',
    description:
      'Record a single significant relationship between two entities from the currently-available <named_entities> list. Source and target must be distinct ids from the list.',
    parameters: AddRelationshipSchema,
    execute: async (_id, args) => {
      const sourceOk = allowedById.has(args.source_id);
      const targetOk = allowedById.has(args.target_id);
      if (!sourceOk || !targetOk) {
        const allowedArr = Array.from(allowedById.values());
        const lines: string[] = [
          'ERROR: Unknown entity id(s) — not in the current <named_entities> list.'
        ];
        if (!sourceOk) {
          const sugg = fuzzyMatchByKey(
            allowedArr,
            args.source_id,
            (e) => e.friendlyId,
            5
          );
          lines.push(
            sugg.length > 0
              ? `- source_id "${args.source_id}" — closest matches: ${sugg.map((s) => `"${s.friendlyId}"`).join(', ')}`
              : `- source_id "${args.source_id}" — no close matches found`
          );
        }
        if (!targetOk) {
          const sugg = fuzzyMatchByKey(
            allowedArr,
            args.target_id,
            (e) => e.friendlyId,
            5
          );
          lines.push(
            sugg.length > 0
              ? `- target_id "${args.target_id}" — closest matches: ${sugg.map((s) => `"${s.friendlyId}"`).join(', ')}`
              : `- target_id "${args.target_id}" — no close matches found`
          );
        }
        lines.push(
          '',
          '→ If a closest match is the entity you meant: retry add_relationship with the corrected id(s).',
          '→ If none of the matches are right: scan the <named_entities> list above for the correct id and retry add_relationship with it.',
          '→ Only skip this relationship if the entity you meant is genuinely not in the list.'
        );
        const msg = lines.join('\n');
        ctx.log.warn(msg);
        throw new Error(msg);
      }

      if (args.source_id === args.target_id) {
        return {
          content: [
            {
              type: 'text',
              text: `Skipped self-relationship "${args.source_id} ${args.predicate_type} ${args.source_id}" — source and target are the same entity.`
            }
          ],
          details: {}
        };
      }

      const key = `${args.source_id}|${args.predicate_type}|${args.target_id}`;
      if (seen.has(key)) {
        return {
          content: [
            {
              type: 'text',
              text: `Already recorded "${args.source_id} ${args.predicate_type} ${args.target_id}", skipping.`
            }
          ],
          details: {}
        };
      }

      seen.add(key);
      relationships.push({
        source_id: args.source_id,
        target_id: args.target_id,
        predicate_type: args.predicate_type,
        predicate_description: args.predicate_description
      });

      return {
        content: [
          {
            type: 'text',
            text: `Recorded ${args.source_id} ${args.predicate_type} ${args.target_id}.`
          }
        ],
        details: {}
      };
    }
  };

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId,
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [addRelationshipTool]
    },
    getApiKey: () => apiKey
  });
  watchAgent('extractChapterRelationships', agent, ctx);

  const runPhase = async (phase: 'character' | 'place' | 'other', text: string) => {
    const beforeCount = relationships.length;
    try {
      await agent.prompt(text);
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) throw e;
      ctx.log.warn(`Relationship extraction (${phase} phase) aborted`);
    }
    if (agent.state.errorMessage) {
      throw new RecoverableError(
        `Agent error in ${phase} phase: ${agent.state.errorMessage}`
      );
    }
    ctx.log.info(
      `Phase ${phase} done: ${relationships.length - beforeCount} new (${relationships.length} total)`
    );
  };

  // Phase 1: CHARACTER ↔ CHARACTER. Always run so the chapter text gets in-session
  // (subsequent phases reference it without re-sending). The prompt handles an
  // empty character list gracefully.
  for (const e of characters) allowedById.set(e.friendlyId, e);
  const charPhaseText = extractRelationshipsCharacterPhase.render({
    characters: characters.map((entity) => ({
      friendlyId: entity.friendlyId,
      name: entityNamesFormatted(entity),
      description: entity.description || undefined
    })),
    scenes: scenes.map((scene) => ({
      attrs: buildSceneAttrs(scene),
      paragraphs: scene.paragraphs.map(({ content }) => content)
    }))
  });
  await runPhase('character', charPhaseText);

  // Phase 2: PLACE-involving
  if (places.length > 0) {
    for (const e of places) allowedById.set(e.friendlyId, e);
    const placePhaseText = extractRelationshipsPlacePhase.render({
      places: places.map((entity) => ({
        friendlyId: entity.friendlyId,
        name: entityNamesFormatted(entity),
        description: entity.description || undefined
      }))
    });
    await runPhase('place', placePhaseText);
  }

  // Phase 3: other-type-involving
  if (others.length > 0) {
    for (const e of others) allowedById.set(e.friendlyId, e);
    const otherPhaseText = extractRelationshipsOtherPhase.render({
      categories: categories.map((category) => ({
        slug: category.type,
        name: category.name,
        description: category.description ?? ''
      })),
      others: others.map((entity) => ({
        friendlyId: entity.friendlyId,
        name: entityNamesFormatted(entity),
        type: entity.type,
        description: entity.description || undefined
      }))
    });
    await runPhase('other', otherPhaseText);
  }

  return relationships;
}
