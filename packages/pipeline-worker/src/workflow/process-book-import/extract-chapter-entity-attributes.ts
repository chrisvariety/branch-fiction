import { Agent } from '@earendil-works/pi-agent-core';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

const ATTRIBUTE_SESSION_NAMESPACE = '7a2b9c4e-5d1f-4a8c-b6e2-d9f4a7c1e5b3';

import { bridgeUpdateBookImport } from '@/lib/bridge';
import {
  getBookEntitiesByBookIdAndNotTypes,
  getBookEntitiesByBookIdAndTypes
} from '@/lib/db/models/book-entity/get-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getBookEntityIdsFromChaptersAppellations } from '@/lib/db/models/chapter-entity-appellation/get-chapter-entity-appellation';
import { createChapterEntityAttributes } from '@/lib/db/models/chapter-entity-attribute/create-chapter-entity-attribute';
import { getNonEmptyChapterParagraphsByChapterIds } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { getChapterSceneGroupById } from '@/lib/db/models/chapter-scene-group/get-chapter-scene-group';
import { getChapterScenesWithSettingAndLocationByIds } from '@/lib/db/models/chapter-scene/get-chapter-scene';
import { RecoverableError, UnrecoverableError } from '@/lib/error-types';
import { fuzzyMatchByKey } from '@/lib/lit/fuzzy-match';
import { gatherMentions } from '@/lib/lit/gather-mentions';
import { entityNamesFormatted } from '@/lib/lit/names';
import { organizeParagraphsIntoScenes } from '@/lib/lit/organize-paragraphs-into-scenes';
import { buildSceneAttrs } from '@/lib/lit/scene-attrs';
import { watchAgent, watchLoopDetection } from '@/lib/llm/agent';
import {
  getAttribute,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@/lib/llm/xml';
import extractCharacterAttributesFromChapter from '@/lib/prompts/import/extract-character-attributes-from-chapter';
import extractEntityAttributesFromChapter from '@/lib/prompts/import/extract-entity-attributes-from-chapter';
import extractPlaceAttributesFromChapter from '@/lib/prompts/import/extract-place-attributes-from-chapter';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

// potential improvement: add_entity_attribute(entity_id, category, name, value, evidence) replaces the XML parse + 2-round correction loop.
// Invalid id → tool throws with fuzzy suggestions
// but, attention dilution is real here, so keep the three type passes separate
// just would align with extract-chapter-relationships + extract-chapter-*-appellations
export const handler = createWorkflowFunction<
  {
    sceneGroupId: string;
    bookImportId: string;
    type: 'CHARACTER' | 'PLACE' | 'ALL_OTHER';
  },
  {
    sceneGroup: NonNullable<Awaited<ReturnType<typeof getChapterSceneGroupById>>>;
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookImport: NonNullable<Awaited<ReturnType<typeof getBookImportById>>>;
    type: 'CHARACTER' | 'PLACE' | 'ALL_OTHER';
  }
>(
  {
    name: ({ sceneGroup }, retryCount) =>
      `Entity Attributes Group ${sceneGroup.idx}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ sceneGroupId, bookImportId, type }) => {
      const sceneGroup = await getChapterSceneGroupById(sceneGroupId);
      const bookImport = await getBookImportById(bookImportId);
      if (!sceneGroup || !bookImport)
        throw new UnrecoverableError('Scene Group or Book Import not found');
      const book = await getBookById(sceneGroup.bookId);
      if (!book) throw new UnrecoverableError('Book not found');
      return { sceneGroup, book, bookImport, type };
    },
    onFailure: async (_, error) => {
      await bridgeUpdateBookImport({
        status: error instanceof UnrecoverableError ? 'failed' : 'pending',
        lastError: error.message,
        incrementErrorCount: true
      });
    }
  },
  async ({ sceneGroup, type }, ctx) => {
    ctx.log
      .withMetadata({
        sceneGroupId: sceneGroup.id,
        sceneGroupIdx: sceneGroup.idx
      })
      .info(`Starting ${type.toLowerCase()} attribute extraction`);

    const allEntities =
      type === 'CHARACTER' || type === 'PLACE'
        ? await getBookEntitiesByBookIdAndTypes(sceneGroup.bookId, [type])
        : await getBookEntitiesByBookIdAndNotTypes(sceneGroup.bookId, [
            'CHARACTER',
            'PLACE'
          ]);

    const scenes = await getChapterScenesWithSettingAndLocationByIds(
      sceneGroup.chapterSceneIds
    );

    const chapterIds = [...new Set(scenes.map((s) => s.chapterId))];
    const paragraphs = await getNonEmptyChapterParagraphsByChapterIds(chapterIds);

    const scenesWithParagraphs = organizeParagraphsIntoScenes(scenes, paragraphs);

    const mentionedEntities =
      type === 'PLACE'
        ? // experimentally just include all places,
          allEntities
        : gatherMentions(
            paragraphs.map((paragraph) => paragraph.content).join('\n'),
            allEntities,
            Array.from(
              new Set(
                scenes.flatMap((scene) =>
                  [
                    scene.povBookEntityId,
                    scene.locationBookEntityId,
                    scene.settingBookEntityId
                  ].filter((id) => id !== null)
                )
              )
            )
          );

    let mentionedEntitiesArray = Array.from(mentionedEntities);

    if (type !== 'PLACE') {
      const mentionedEntityIds = new Set(Array.from(mentionedEntities, (e) => e.id));

      // Appellations can help catch references where the entity isn't referred to with a verbatim phrase
      const appellationEntityIds = await getBookEntityIdsFromChaptersAppellations(
        chapterIds,
        allEntities.map((e) => e.id)
      );

      mentionedEntitiesArray = Array.from(mentionedEntities).concat(
        allEntities
          .filter(
            (e) => appellationEntityIds.includes(e.id) && !mentionedEntityIds.has(e.id)
          )
          .map((e) => ({ ...e, mentionCount: 1, phrasesMentioned: [] }))
      );
    }

    // Skip LLM call if no entities to process
    if (mentionedEntitiesArray.length === 0) {
      ctx.log
        .withMetadata({
          sceneGroupId: sceneGroup.id,
          sceneGroupIdx: sceneGroup.idx
        })
        .info(
          `Skipping ${type.toLowerCase()} attribute extraction - no entities mentioned`
        );

      return Response.json({
        sceneGroupId: sceneGroup.id,
        entityAttributesCount: 0
      });
    }

    const entityAttributes = await extractChapterEntityAttributes(
      {
        type,
        entities: mentionedEntitiesArray,
        scenes: scenesWithParagraphs.map((scene) => ({
          pov: scene.pov,
          povEntity: scene.povEntity,
          paragraphs: scene.paragraphs,
          location: scene.location,
          setting: scene.setting
        })),
        sessionId: uuidv5(sceneGroup.id, ATTRIBUTE_SESSION_NAMESPACE)
      },
      ctx
    );

    const entityAttributesWithEntityId = entityAttributes.map((entityAttribute) => {
      const entity = mentionedEntitiesArray.find(
        (entity) => entity.friendlyId === entityAttribute.id
      );

      if (!entity) {
        throw new RecoverableError(
          `Entity not found for entity attribute: ${entityAttribute.id} (full attribute: ${JSON.stringify(entityAttribute)})`
        );
      }
      return {
        ...entityAttribute,
        entityId: entity.id
      };
    });

    const toInsert = entityAttributesWithEntityId.flatMap((entityAttributes) =>
      entityAttributes.attributes.map((entityAttribute) => ({
        id: uuidv7(),
        bookId: sceneGroup.bookId,
        chapterId: sceneGroup.startChapterId,
        bookEntityId: entityAttributes.entityId,
        category: entityAttribute.category,
        name: entityAttribute.name,
        value: entityAttribute.value,
        evidence: entityAttribute.evidence
      }))
    );

    const CHUNK_SIZE = 1000;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      await createChapterEntityAttributes(toInsert.slice(i, i + CHUNK_SIZE));
    }

    return Response.json({
      sceneGroupId: sceneGroup.id,
      entityAttributesCount: entityAttributes.length
    });
  }
);

const AttributeArraySchema = v.array(
  v.object({
    id: v.string(),
    attributes: v.array(
      v.object({
        category: v.string(),
        name: v.string(),
        value: v.string(),
        evidence: v.string()
      })
    )
  })
);

const EntityOutputSchema = v.object({ entities: AttributeArraySchema });

const CharacterOutputSchema = v.object({ characters: AttributeArraySchema });

async function extractChapterEntityAttributes(
  {
    type,
    entities,
    scenes,
    sessionId
  }: {
    type: 'CHARACTER' | 'PLACE' | 'ALL_OTHER';
    entities: {
      friendlyId: string;
      names: string[];
      name: string;
      type: string;
      aliases: string[];
      pronouns?: string | null;
      description?: string | null;
    }[];
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
  const mappedEntities = entities.map((entity) => ({
    friendlyId: entity.friendlyId,
    name: entityNamesFormatted(entity),
    description: entity.description || undefined,
    type: entity.type
  }));

  const mappedScenes = scenes.map((scene) => ({
    attrs: buildSceneAttrs(scene),
    paragraphs: scene.paragraphs.map(({ content }) => content)
  }));

  const userText =
    type === 'CHARACTER'
      ? extractCharacterAttributesFromChapter.render({
          characters: mappedEntities,
          scenes: mappedScenes
        })
      : type === 'PLACE'
        ? extractPlaceAttributesFromChapter.render({
            entities: mappedEntities,
            scenes: mappedScenes
          })
        : extractEntityAttributesFromChapter.render({
            entities: mappedEntities,
            scenes: mappedScenes
          });

  const wrapperName = type === 'CHARACTER' ? 'characters' : 'entities';
  const itemTag = type === 'CHARACTER' ? 'character' : 'entity';
  const validIds = new Set(entities.map((e) => e.friendlyId));

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId,
    initialState: { model, thinkingLevel: reasoning, tools: [] },
    getApiKey: () => apiKey
  });
  const aw = watchAgent('extractChapterEntityAttributes', agent, ctx, wrapperName);
  const lw = watchLoopDetection(agent, { itemTag });

  const MAX_CORRECTION_ROUNDS = 2;

  type Item = {
    id: string;
    attributes: { category: string; name: string; value: string; evidence: string }[];
  };
  const accumulatedValid: Item[] = [];

  let nextPrompt = userText;
  for (let round = 0; round <= MAX_CORRECTION_ROUNDS; round++) {
    aw.xml = null;
    try {
      await agent.prompt(nextPrompt);
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) throw e;
    }

    if (lw.loopDetected) {
      throw new RecoverableError(
        `Loop detected in <${lw.loopDetected.itemTag}> (${lw.loopDetected.count}x): ${lw.loopDetected.sampleBlock}`
      );
    }

    if (agent.state.errorMessage) {
      throw new RecoverableError(`Agent error: ${agent.state.errorMessage}`);
    }

    const xml = aw.xml;
    if (!xml) {
      throw new RecoverableError(`No <${wrapperName}> found in response`);
    }

    const ast = parse(xml);
    const itemNodes = querySelectorAll(ast, itemTag);
    const items: Item[] = itemNodes.map((node) => ({
      id: getAttribute(node, 'id') || '',
      attributes: querySelectorAll(node, 'attribute').map((attrNode) => ({
        category: getAttribute(attrNode, 'category') || '',
        name: getAttribute(attrNode, 'name') || '',
        value: getText(querySelector(attrNode, 'value')).trim(),
        evidence: getText(querySelector(attrNode, 'evidence')).trim()
      }))
    }));

    let validatedItems: Item[];
    if (type === 'CHARACTER') {
      const validated = v.safeParse(CharacterOutputSchema, { characters: items });
      if (!validated.success) {
        ctx.log.error(`Validation error: ${v.summarize(validated.issues)}`);
        throw new RecoverableError(
          `Failed to parse character attributes: ${v.summarize(validated.issues)}`
        );
      }
      validatedItems = validated.output.characters;
    } else {
      const validated = v.safeParse(EntityOutputSchema, { entities: items });
      if (!validated.success) {
        ctx.log.error(`Validation error: ${v.summarize(validated.issues)}`);
        throw new RecoverableError(
          `Failed to parse entity attributes: ${v.summarize(validated.issues)}`
        );
      }
      validatedItems = validated.output.entities;
    }

    const newlyValid = validatedItems.filter((it) => validIds.has(it.id));
    const newlyInvalid = validatedItems.filter((it) => !validIds.has(it.id));
    accumulatedValid.push(...newlyValid);

    if (newlyInvalid.length === 0) {
      return accumulatedValid;
    }

    if (round === MAX_CORRECTION_ROUNDS) {
      throw new RecoverableError(
        `Could not resolve invalid ${itemTag} ids after ${MAX_CORRECTION_ROUNDS + 1} attempts: ${newlyInvalid.map((i) => i.id).join(', ')}`
      );
    }

    const correctionLines = newlyInvalid.map((it) => {
      const suggestions = fuzzyMatchByKey(entities, it.id, (e) => e.friendlyId, 5);
      return suggestions.length > 0
        ? `- "${it.id}" — closest matches: ${suggestions.map((s) => `"${s.friendlyId}"`).join(', ')}`
        : `- "${it.id}" — no close matches found`;
    });

    const correctionText = [
      `The following ids in your response are not in the provided ${itemTag} list:`,
      ...correctionLines,
      '',
      `Reply with a single <${wrapperName}> block containing ONLY corrected <${itemTag}> entries for the ids listed above — do NOT repeat your previously valid entries (we have already kept those).`,
      `For each invalid id: if one of the suggested ids represents what you meant, re-emit that <${itemTag}> using the corrected id. If none of the suggestions match, omit that <${itemTag}> entirely (drop it).`,
      `If every invalid entry should be dropped, reply with an empty block: <${wrapperName}></${wrapperName}>.`
    ].join('\n');

    ctx.log.info(
      `Requesting id correction for: ${newlyInvalid.map((i) => i.id).join(', ')}`
    );

    nextPrompt = correctionText;
  }

  throw new RecoverableError('Correction loop exited unexpectedly');
}
