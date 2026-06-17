import {
  getAttribute,
  extractWrappedXml,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { NewBookArc } from '@/app/lib/db/types';
import { getDb } from '@/lib/db';
import { createBookArcs } from '@/lib/db/models/book-arc/create-book-arc';
import {
  generateUniqueArcFriendlyPrefix,
  getBookArcsWithEntitiesByBookIdAndType
} from '@/lib/db/models/book-arc/get-book-arc';
import {
  getBookEntitiesByBookId,
  getBookEntitiesByBookIdAndTypesAndSignificanceTiers
} from '@/lib/db/models/book-entity/get-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getChapterEntityAttributesByBookId } from '@/lib/db/models/chapter-entity-attribute/get-chapter-entity-attribute';
import { getNonEmptyChapterParagraphsByBookId } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { getChapterRelationshipsWithChapterAndEntitiesByBookId } from '@/lib/db/models/chapter-relationship/get-chapter-relationship';
import {
  getChapterByBookIdAndChapterIdx,
  getMaxChapterIdxByBookId
} from '@/lib/db/models/chapter/get-chapter';
import { parseChapterRange } from '@/lib/lit/chapter-range';
import { SignificanceTier } from '@/lib/lit/entity-significance';
import { entityThresholds } from '@/lib/lit/entity-significance-estimate';
import { gatherMentions } from '@/lib/lit/gather-mentions';
import { isolateArcs } from '@/lib/lit/isolate-arcs';
import { buildRelationshipGraph } from '@/lib/lit/relationship-graph';
import { estimateTokens } from '@/lib/llm/estimate-tokens';
import extractRelatedCharacterRelationshipArcPrompt from '@/lib/prompts/post-processing/extract-related-character-relationship-arc';
import extractRelatedPlaceRelationshipArcPrompt from '@/lib/prompts/post-processing/extract-related-place-relationship-arc';
import { reportStepProgress } from '@/lib/step-projection';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 10;

export const handler = createWorkflowFunction<
  {
    bookId: string;
    significanceTiers: SignificanceTier[];
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    significanceTiers: SignificanceTier[];
  },
  { bookId: string; arcsCreated: number }
>(
  {
    name: ({ book }, retryCount) =>
      `Extract Related Entity Arc ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId, significanceTiers }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');
      if (!significanceTiers?.length)
        throw new UnrecoverableError('Significance Tiers not provided');

      return { book, significanceTiers };
    },
    check: async (_payload, result) => ({
      passed: result.arcsCreated >= 0,
      severity: 'WARN' as const,
      metadata: { arcsCreated: result.arcsCreated }
    })
  },
  async ({ book, significanceTiers }, ctx) => {
    const stepStartMs = Date.now();
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title,
        significanceTiers
      })
      .info('Starting related entity arc extraction');

    const allParagraphs = await getNonEmptyChapterParagraphsByBookId(book.id);
    const bookTokens = allParagraphs.reduce(
      (sum, p) => sum + estimateTokens(p.content),
      0
    );

    // Check if related relationship arcs already exist and extract covered entity IDs
    const existingArcs = await getBookArcsWithEntitiesByBookIdAndType(
      book.id,
      'RELATED_RELATIONSHIP'
    );

    // Extract unique entity IDs that already have related relationship arc coverage
    const coveredEntityIds = new Set(
      existingArcs.flatMap((arc) => arc.bookEntities.map((entity) => entity.id))
    );

    ctx.log.info(
      `Found ${existingArcs.length} existing related relationship arcs covering ${coveredEntityIds.size} unique entities`
    );

    // Fetch top CHARACTER and PLACE entities for the book with specified significance tiers
    const topCharacters = await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
      book.id,
      ['CHARACTER'],
      significanceTiers
    );

    const topPlaces = await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
      book.id,
      ['PLACE'],
      significanceTiers
    );

    if (topCharacters.length === 0 && topPlaces.length === 0) {
      ctx.log.info(
        'No CHARACTER or PLACE entities found for related entity arc extraction'
      );
      return {
        bookId: book.id,
        arcsCreated: 0
      };
    }

    ctx.log.info(
      `Found ${topCharacters.length} top CHARACTERs and ${topPlaces.length} top PLACEs`
    );

    await ctx.narrate(
      `Filling in those little details for ${topCharacters.length} ${topCharacters.length === 1 ? 'character' : 'characters'} and ${topPlaces.length} ${topPlaces.length === 1 ? 'place' : 'places'}: how do secondary world elements (objects, organizations, magic) connect to the main characters and places?`
    );

    const topCharacterIds = new Set(topCharacters.map((c) => c.id));
    const topPlaceIds = new Set(topPlaces.map((p) => p.id));

    const allAttributes = await getChapterEntityAttributesByBookId(book.id);
    const allEntities = await getBookEntitiesByBookId(book.id);

    const entityMap = new Map(allEntities.map((e) => [e.id, e]));

    // get ALL place IDs (for including non-top places mentioned in relationships)
    const allPlaceIds = new Set(
      allEntities.filter((e) => e.type === 'PLACE').map((e) => e.id)
    );

    // group attributes by bookEntityId and count
    const attributeCountsByEntity = new Map<string, number>();
    for (const attr of allAttributes) {
      const count = attributeCountsByEntity.get(attr.bookEntityId) ?? 0;
      attributeCountsByEntity.set(attr.bookEntityId, count + 1);
    }

    const attributeEntities = Array.from(attributeCountsByEntity.entries())
      .filter(([id]) => !topCharacterIds.has(id) && !topPlaceIds.has(id))
      .map(([id, attributeCount]) => {
        const entity = entityMap.get(id);
        return {
          id,
          friendlyId: entity?.friendlyId ?? 'unknown',
          name: entity?.name ?? 'Unknown',
          type: entity?.type ?? 'UNKNOWN',
          attributeCount
        };
      })
      .filter((e) => e.type !== 'PLACE');

    if (attributeEntities.length === 0) {
      ctx.log.info('No entities with attributes found (excluding top chars/places)');
      return {
        bookId: book.id,
        arcsCreated: 0
      };
    }

    const attributeEntitiesFull = attributeEntities
      .map((e) => entityMap.get(e.id))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);

    // count external mentions per entity (for threshold calculation)
    const externalMentionCounts = new Map<string, number>();
    for (const attr of allAttributes) {
      // skip if this attribute belongs to one of the entities being considered
      if (attributeEntities.some((ae) => ae.id === attr.bookEntityId)) continue;

      const attrText = `${attr.name} ${attr.value} ${attr.evidence}`;
      const mentioned = gatherMentions(attrText, attributeEntitiesFull);

      for (const entity of mentioned) {
        const count = externalMentionCounts.get(entity.id) ?? 0;
        externalMentionCounts.set(entity.id, count + 1);
      }
    }

    ctx.log.info(
      `Found external mention counts for ${externalMentionCounts.size} entities`
    );

    // add mention counts to attribute entities for combined significance
    const attributeEntitiesWithMentions = attributeEntities.map((e) => ({
      ...e,
      mentionCount: externalMentionCounts.get(e.id) ?? 0,
      combinedCount: e.attributeCount + (externalMentionCounts.get(e.id) ?? 0)
    }));

    // calculate thresholds based on combined counts (attributes + mentions)
    const combinedCounts = attributeEntitiesWithMentions.map((e) => e.combinedCount);
    const { primaryThreshold } = entityThresholds(combinedCounts, 1);

    // filter to PRIMARY entities (above threshold)
    const significantEntities = attributeEntitiesWithMentions
      .filter((e) => e.combinedCount >= primaryThreshold)
      .sort((a, b) => b.combinedCount - a.combinedCount);

    ctx.log.info(
      `Found ${significantEntities.length} significant entities (PRIMARY) from ${attributeEntitiesWithMentions.length} total (using combined attribute+mention counts)`
    );

    // filter out entities that already have coverage
    const newEntities = significantEntities.filter((e) => !coveredEntityIds.has(e.id));

    if (newEntities.length === 0) {
      ctx.log.info(
        'All significant related entities already have arc coverage - skipping extraction'
      );
      return {
        bookId: book.id,
        arcsCreated: 0
      };
    }

    ctx.log.info(
      `Found ${newEntities.length} new significant entities without arc coverage`
    );

    const allRelationships = await getChapterRelationshipsWithChapterAndEntitiesByBookId(
      book.id
    );

    const graph = buildRelationshipGraph(allRelationships);

    const attributesByEntityId = new Map<string, typeof allAttributes>();
    for (const attr of allAttributes) {
      if (!attributesByEntityId.has(attr.bookEntityId)) {
        attributesByEntityId.set(attr.bookEntityId, []);
      }
      attributesByEntityId.get(attr.bookEntityId)!.push(attr);
    }

    const entitiesByType = new Map<string, typeof newEntities>();
    for (const entity of newEntities) {
      if (!entitiesByType.has(entity.type)) {
        entitiesByType.set(entity.type, []);
      }
      entitiesByType.get(entity.type)!.push(entity);
    }

    ctx.log.info(
      `Grouped entities into ${entitiesByType.size} types: ${Array.from(entitiesByType.keys()).join(', ')}`
    );

    type ExternalMention = {
      sourceEntityId: string;
      sourceEntityFriendlyId: string;
      sourceEntityName: string;
      sourceEntityType: string;
      chapterIdx: number;
      category: string;
      name: string;
      value: string;
      evidence: string;
    };

    const externalMentionsByEntityId = new Map<string, ExternalMention[]>();

    const newEntitiesFull = newEntities
      .map((e) => entityMap.get(e.id))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);

    ctx.log.info(
      `Scanning ${allAttributes.length} attributes for mentions of ${newEntitiesFull.length} entities`
    );

    // check each attribute for mentions of the new entities
    for (const attr of allAttributes) {
      // skip if this attribute belongs to one of the new entities being processed
      if (newEntities.some((ne) => ne.id === attr.bookEntityId)) continue;

      const attrText = `${attr.name} ${attr.value} ${attr.evidence}`;
      const mentioned = gatherMentions(attrText, newEntitiesFull);

      if (mentioned.size === 0) continue;

      const sourceEntity = entityMap.get(attr.bookEntityId);
      if (!sourceEntity) continue;

      for (const entity of mentioned) {
        if (!externalMentionsByEntityId.has(entity.id)) {
          externalMentionsByEntityId.set(entity.id, []);
        }
        externalMentionsByEntityId.get(entity.id)!.push({
          sourceEntityId: sourceEntity.id,
          sourceEntityFriendlyId: sourceEntity.friendlyId,
          sourceEntityName: sourceEntity.name,
          sourceEntityType: sourceEntity.type,
          chapterIdx: attr.chapterIdx,
          category: attr.category,
          name: attr.name,
          value: attr.value,
          evidence: attr.evidence
        });
      }
    }

    ctx.log.info(
      `Found external mentions for ${externalMentionsByEntityId.size} entities`
    );

    const maxChapterIdx = await getMaxChapterIdxByBookId(book.id);

    let totalArcsCreated = 0;

    type ArcSnapshot = {
      entityId: string;
      linkedEntityIds: string[]; // character IDs or place IDs
      tagline: string;
      chapters: string;
      detail: string;
    };

    async function saveSnapshots(snapshots: ArcSnapshot[]): Promise<number> {
      if (snapshots.length === 0) return 0;

      const arcsToInsert: Array<
        Omit<NewBookArc, 'friendlyIdPrefix' | 'friendlyId' | 'friendlyIdIdx'>
      > = [];

      for (const snapshot of snapshots) {
        const chapterRange = parseChapterRange(snapshot.chapters, maxChapterIdx);

        const startChapter = await getChapterByBookIdAndChapterIdx(
          book.id,
          chapterRange.startChapterIdx
        );
        const endChapter = await getChapterByBookIdAndChapterIdx(
          book.id,
          chapterRange.endChapterIdx
        );

        if (!startChapter || !endChapter) {
          throw new RecoverableError(
            `Could not find chapters for range ${chapterRange.startChapterIdx}-${chapterRange.endChapterIdx} in arc "${snapshot.tagline}", skipping`
          );
        }

        const bookEntityIds = [snapshot.entityId, ...snapshot.linkedEntityIds];

        arcsToInsert.push({
          id: uuidv7(),
          bookId: book.id,
          type: 'RELATED_RELATIONSHIP',
          startChapterId: startChapter.id,
          endChapterId: endChapter.id,
          title: snapshot.tagline,
          content: snapshot.detail,
          bookEntityIds
        });
      }

      const arcsByEntityIds = new Map<string, typeof arcsToInsert>();
      for (const arc of arcsToInsert) {
        const key = [...arc.bookEntityIds].sort().join(',');
        if (!arcsByEntityIds.has(key)) {
          arcsByEntityIds.set(key, []);
        }
        arcsByEntityIds.get(key)!.push(arc);
      }

      const createdArcs = await getDb()
        .transaction()
        .execute(async (trx) => {
          const allArcs: Awaited<ReturnType<typeof createBookArcs>> = [];

          for (const arcsGroup of arcsByEntityIds.values()) {
            const friendlyIdPrefix = await generateUniqueArcFriendlyPrefix({
              bookId: book.id,
              arcType: 'RELATED_RELATIONSHIP',
              entityIds: arcsGroup[0].bookEntityIds,
              trx
            });

            const arcs = await createBookArcs(arcsGroup, friendlyIdPrefix, trx);
            allArcs.push(...arcs);
          }

          return allArcs;
        });

      // isolate arcs inline. group by friendlyIdPrefix since each entity group has its own
      const arcsByPrefix = new Map<string, typeof createdArcs>();
      for (const arc of createdArcs) {
        const existing = arcsByPrefix.get(arc.friendlyIdPrefix) || [];
        existing.push(arc);
        arcsByPrefix.set(arc.friendlyIdPrefix, existing);
      }
      for (const groupArcs of arcsByPrefix.values()) {
        const entityInfos = groupArcs[0].bookEntityIds
          .map((id) => entityMap.get(id))
          .filter((e): e is NonNullable<typeof e> => e !== undefined)
          .map((e) => ({ name: e.name, type: e.type }));
        await isolateArcs(
          {
            arcType: 'RELATED_RELATIONSHIP',
            arcs: groupArcs,
            bookId: book.id,
            bookTitle: book.title,
            entities: entityInfos
          },
          ctx
        );
      }

      return createdArcs.length;
    }

    // Rough upper bound on LLM batches across all (type, phase) pairs. validEntities
    // filtering will shrink the real count, so fractionOfStepComplete may peak below 1.
    let estimatedTotalBatches = 0;
    for (const [entityType, entities] of entitiesByType) {
      const batches = Math.ceil(entities.length / BATCH_SIZE);
      estimatedTotalBatches += batches;
      if (entityType !== 'CHARACTER') estimatedTotalBatches += batches;
    }
    estimatedTotalBatches = Math.max(1, estimatedTotalBatches);
    let batchesDone = 0;

    for (const [entityType, entities] of entitiesByType) {
      ctx.log.info(`Processing ${entities.length} entities of type ${entityType}`);

      const entitiesWithData = entities.map((entity) => {
        const entityRelationshipsRaw = allRelationships.filter(
          (rel) => rel.sourceEntity.id === entity.id || rel.targetEntity.id === entity.id
        );

        const relationshipAttributes: AttributeInput[] = entityRelationshipsRaw
          .sort((a, b) => a.chapter.idx - b.chapter.idx)
          .map((rel) => {
            const isSource = rel.sourceEntity.id === entity.id;
            const otherEntity = isSource ? rel.targetEntity : rel.sourceEntity;

            return {
              chapterIdx: rel.chapter.idx,
              category: 'RELATIONSHIP',
              name: rel.predicateType,
              value: rel.predicateDescription,
              evidence: '',
              source: {
                friendlyId: otherEntity.friendlyId,
                name: otherEntity.name,
                type: otherEntity.type,
                label: 'relationship with'
              }
            };
          });

        const attributes = attributesByEntityId.get(entity.id) ?? [];

        const connectedCharacterIds = new Set<string>();
        if (graph.hasNode(entity.id)) {
          for (const neighborId of graph.neighbors(entity.id)) {
            if (topCharacterIds.has(neighborId)) {
              connectedCharacterIds.add(neighborId);
            }
          }
        }

        const connectedPlaceIds = new Set<string>();
        if (graph.hasNode(entity.id)) {
          for (const neighborId of graph.neighbors(entity.id)) {
            if (allPlaceIds.has(neighborId)) {
              connectedPlaceIds.add(neighborId);
            }
          }
        }

        const attributesText = attributes
          .map((attr) => `${attr.name} ${attr.value} ${attr.evidence}`)
          .join(' ');
        const relationshipsText = relationshipAttributes
          .map((attr) => `${attr.name} ${attr.value}`)
          .join(' ');
        const mentionText = [attributesText, relationshipsText]
          .filter((text) => text.trim().length > 0)
          .join(' ');

        if (mentionText) {
          const mentionedCharacters = gatherMentions(mentionText, topCharacters);
          for (const char of mentionedCharacters) {
            connectedCharacterIds.add(char.id);
          }

          const allPlaceEntities = allEntities.filter((e) => e.type === 'PLACE');
          const mentionedPlaces = gatherMentions(mentionText, allPlaceEntities);
          for (const place of mentionedPlaces) {
            connectedPlaceIds.add(place.id);
          }
        }

        const externalMentions = externalMentionsByEntityId.get(entity.id) ?? [];

        // also add source entities from external mentions to connected sets
        for (const mention of externalMentions) {
          if (topCharacterIds.has(mention.sourceEntityId)) {
            connectedCharacterIds.add(mention.sourceEntityId);
          }
          if (allPlaceIds.has(mention.sourceEntityId)) {
            connectedPlaceIds.add(mention.sourceEntityId);
          }
        }

        const mergedAttributes: AttributeInput[] = [
          ...attributes.map((attr) => ({
            chapterIdx: attr.chapterIdx,
            category: attr.category,
            name: attr.name,
            value: attr.value,
            evidence: attr.evidence
          })),
          ...relationshipAttributes,
          ...externalMentions.map((mention) => ({
            chapterIdx: mention.chapterIdx,
            category: mention.category,
            name: mention.name,
            value: mention.value,
            evidence: mention.evidence,
            source: {
              friendlyId: mention.sourceEntityFriendlyId,
              name: mention.sourceEntityName,
              type: mention.sourceEntityType,
              label: 'from'
            }
          }))
        ].sort((a, b) => a.chapterIdx - b.chapterIdx);

        return {
          ...entity,
          attributes: mergedAttributes,
          connectedCharacterIds,
          connectedPlaceIds
        };
      });

      const validEntities = entitiesWithData.filter((e) => e.attributes.length > 0);

      if (validEntities.length === 0) {
        ctx.log.info(`No valid entities for type ${entityType}, skipping`);
        continue;
      }

      const entitiesWithCharacters = validEntities.filter(
        (e) => e.connectedCharacterIds.size > 0
      );

      ctx.log.info(
        `Type ${entityType}: Processing ${entitiesWithCharacters.length} entities with character connections in batches of ${BATCH_SIZE}`
      );

      for (let i = 0; i < entitiesWithCharacters.length; i += BATCH_SIZE) {
        const batch = entitiesWithCharacters.slice(i, i + BATCH_SIZE);

        const batchCharacterIds = new Set<string>();
        for (const entity of batch) {
          for (const id of entity.connectedCharacterIds) {
            batchCharacterIds.add(id);
          }
        }

        const characters = topCharacters
          .filter((c) => batchCharacterIds.has(c.id))
          .map((c) => ({
            id: c.id,
            friendlyId: c.friendlyId,
            name: c.name
          }));

        if (characters.length === 0) continue;

        ctx.log.info(
          `Processing character batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(entitiesWithCharacters.length / BATCH_SIZE)} (${batch.length} entities, ${characters.length} characters)`
        );

        try {
          const result = await extractEntityArcsForCharacters(
            {
              entityType,
              entities: batch.map((e) => ({
                id: e.id,
                friendlyId: e.friendlyId,
                name: e.name,
                attributes: e.attributes
              })),
              characters
            },
            ctx
          );

          ctx.log.info(
            `Character batch ${Math.floor(i / BATCH_SIZE) + 1}: Generated ${result.snapshots.length} snapshots`
          );

          const characterIdMap = new Map(characters.map((c) => [c.friendlyId, c.id]));
          const entityIdMap = new Map(batch.map((e) => [e.friendlyId, e.id]));

          const batchSnapshots: ArcSnapshot[] = [];
          for (const snapshot of result.snapshots) {
            const entityId = entityIdMap.get(snapshot.entityFriendlyId);
            if (!entityId) {
              ctx.log.warn(
                `Unknown entity friendlyId in snapshot: ${snapshot.entityFriendlyId}`
              );
              continue;
            }

            const linkedEntityIds = snapshot.linkedFriendlyIds
              .map((friendlyId) => characterIdMap.get(friendlyId))
              .filter((id): id is string => id !== undefined);

            batchSnapshots.push({
              entityId,
              linkedEntityIds,
              tagline: snapshot.tagline,
              chapters: snapshot.chapters,
              detail: snapshot.detail
            });
          }

          const savedCount = await saveSnapshots(batchSnapshots);
          totalArcsCreated += savedCount;
          ctx.log.info(
            `Character batch ${Math.floor(i / BATCH_SIZE) + 1}: Saved ${savedCount} arcs (total: ${totalArcsCreated})`
          );
        } catch (error) {
          ctx.log
            .withMetadata({ error, entityIds: batch.map((e) => e.friendlyId) })
            .error(`Error processing character batch ${Math.floor(i / BATCH_SIZE) + 1}`);
        }

        batchesDone++;
        reportStepProgress(ctx, {
          stepId: 'extract_related_relationship_arc',
          stepStartMs,
          fractionOfStepComplete: batchesDone / estimatedTotalBatches,
          bookTokens
        });
      }

      if (entityType === 'CHARACTER') {
        ctx.log.info(
          `Type ${entityType}: Skipping place connections (not relevant for characters)`
        );
        continue;
      }

      // next up, PLACE entities
      const entitiesWithPlaces = validEntities.filter(
        (e) => e.connectedPlaceIds.size > 0
      );

      ctx.log.info(
        `Type ${entityType}: Processing ${entitiesWithPlaces.length} entities with place connections in batches of ${BATCH_SIZE}`
      );

      for (let i = 0; i < entitiesWithPlaces.length; i += BATCH_SIZE) {
        const batch = entitiesWithPlaces.slice(i, i + BATCH_SIZE);

        // Collect union of all connected places across the batch
        const batchPlaceIds = new Set<string>();
        for (const entity of batch) {
          for (const id of entity.connectedPlaceIds) {
            batchPlaceIds.add(id);
          }
        }

        const places = Array.from(batchPlaceIds)
          .map((id) => entityMap.get(id))
          .filter((e): e is NonNullable<typeof e> => e !== undefined)
          .map((p) => ({
            id: p.id,
            friendlyId: p.friendlyId,
            name: p.name
          }));

        if (places.length === 0) continue;

        ctx.log.info(
          `Processing place batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(entitiesWithPlaces.length / BATCH_SIZE)} (${batch.length} entities, ${places.length} places)`
        );

        try {
          const result = await extractEntityArcsForPlaces(
            {
              entityType,
              entities: batch.map((e) => ({
                id: e.id,
                friendlyId: e.friendlyId,
                name: e.name,
                attributes: e.attributes
              })),
              places
            },
            ctx
          );

          ctx.log.info(
            `Place batch ${Math.floor(i / BATCH_SIZE) + 1}: Generated ${result.snapshots.length} snapshots`
          );

          const placeIdMap = new Map(places.map((p) => [p.friendlyId, p.id]));
          const entityIdMap = new Map(batch.map((e) => [e.friendlyId, e.id]));

          const batchSnapshots: ArcSnapshot[] = [];
          for (const snapshot of result.snapshots) {
            const entityId = entityIdMap.get(snapshot.entityFriendlyId);
            if (!entityId) {
              ctx.log.warn(
                `Unknown entity friendlyId in snapshot: ${snapshot.entityFriendlyId}`
              );
              continue;
            }

            const linkedEntityIds = snapshot.linkedFriendlyIds
              .map((friendlyId) => placeIdMap.get(friendlyId))
              .filter((id): id is string => id !== undefined);

            batchSnapshots.push({
              entityId,
              linkedEntityIds,
              tagline: snapshot.tagline,
              chapters: snapshot.chapters,
              detail: snapshot.detail
            });
          }

          const savedCount = await saveSnapshots(batchSnapshots);
          totalArcsCreated += savedCount;
          ctx.log.info(
            `Place batch ${Math.floor(i / BATCH_SIZE) + 1}: Saved ${savedCount} arcs (total: ${totalArcsCreated})`
          );
        } catch (error) {
          ctx.log
            .withMetadata({ error, entityIds: batch.map((e) => e.friendlyId) })
            .error(`Error processing place batch ${Math.floor(i / BATCH_SIZE) + 1}`);
        }

        batchesDone++;
        reportStepProgress(ctx, {
          stepId: 'extract_related_relationship_arc',
          stepStartMs,
          fractionOfStepComplete: batchesDone / estimatedTotalBatches,
          bookTokens
        });
      }
    }

    ctx.log.info(`Total ${totalArcsCreated} related entity arc snapshots created`);

    return {
      bookId: book.id,
      arcsCreated: totalArcsCreated
    };
  }
);

const SnapshotSchema = v.object({
  entityFriendlyId: v.string(),
  linkedFriendlyIds: v.array(v.string()),
  tagline: v.string(),
  chapters: v.string(),
  detail: v.string()
});

const EntityArcOutputSchema = v.object({
  snapshots: v.array(SnapshotSchema)
});

type AttributeInput = {
  chapterIdx: number;
  category: string;
  name: string;
  value: string;
  evidence: string;
  source?: {
    friendlyId: string;
    name: string;
    type: string;
    label?: string; // e.g., "mentioned by" or "relationship with"
  };
};

type EntityInput = {
  id: string;
  friendlyId: string;
  name: string;
  attributes: AttributeInput[];
};

async function extractEntityArcsForCharacters(
  {
    entityType,
    entities,
    characters
  }: {
    entityType: string;
    entities: EntityInput[];
    characters: Array<{ id: string; friendlyId: string; name: string }>;
  },
  ctx: WorkflowContext
) {
  let validationErrors: string[] = [];
  let attempt = 0;

  const userText = extractRelatedCharacterRelationshipArcPrompt.render({
    entityType,
    entities: entities.map((e) => ({
      friendlyId: e.friendlyId,
      name: e.name,
      attributes: e.attributes
    })),
    characters: characters.map((c) => ({
      friendlyId: c.friendlyId,
      name: c.name
    }))
  });

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    const entityName = entities[0]?.name ?? 'Unknown';
    ctx.log.info(
      `Entity arc extraction (characters) attempt ${attempt} of ${MAX_ATTEMPTS} for ${entityName}`
    );

    const { model, apiKey, reasoning } = ctx.getPiModel('piText');
    const message = await ctx.traceComplete(
      'extractEntityArcsForCharacters',
      model,
      { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
      { apiKey, reasoning, sessionId: uuidv7() }
    );
    ctx.trackUsage(message);
    const text = getAssistantText(message);
    const xml = extractWrappedXml(text, 'snapshots');

    if (!xml) {
      ctx.log.warn(`Agent: ${text}`);
      throw new RecoverableError('No snapshots found in response');
    }
    ctx.log.info(`Agent: captured <snapshots> (length: ${xml.length})`);

    const ast = parse(xml);
    const snapshotNodes = querySelectorAll(ast, 'snapshot');

    const data = {
      snapshots: snapshotNodes.map((snapshot) => ({
        entityFriendlyId: getAttribute(snapshot, 'entity_id') ?? '',
        linkedFriendlyIds: querySelectorAll(snapshot, 'character_id').map((c) =>
          getText(c).trim()
        ),
        tagline: getText(querySelector(snapshot, 'tagline')).trim(),
        chapters: getText(querySelector(snapshot, 'chapters')).trim(),
        detail: getText(querySelector(snapshot, 'detail')).trim()
      }))
    };

    const validatedData = v.safeParse(EntityArcOutputSchema, data);

    if (!validatedData.success) {
      ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
      throw new RecoverableError(
        `Failed to parse entity arc snapshots: ${v.summarize(validatedData.issues)}`
      );
    }

    if (validatedData.output.snapshots.length === 0) {
      ctx.log.warn('No snapshots found in response');
      return { snapshots: [] };
    }

    for (const arc of validatedData.output.snapshots) {
      arc.linkedFriendlyIds = [...new Set(arc.linkedFriendlyIds)];
    }

    validationErrors = [];
    const validEntityIds = new Set(entities.map((e) => e.friendlyId));
    const validCharacterIds = new Set(characters.map((c) => c.friendlyId));

    const filteredSnapshots = [];
    for (const arc of validatedData.output.snapshots) {
      if (!validEntityIds.has(arc.entityFriendlyId)) {
        validationErrors.push(
          `Snapshot references invalid entity ID: ${arc.entityFriendlyId}. Valid IDs: ${Array.from(validEntityIds).join(', ')}`
        );
        continue;
      }

      const invalidCharacters = arc.linkedFriendlyIds.filter(
        (id) => !validCharacterIds.has(id)
      );
      if (invalidCharacters.length > 0) {
        ctx.log.warn(
          `Arc "${arc.tagline}" references unknown character IDs (filtered out): ${invalidCharacters.join(', ')}`
        );
      }

      arc.linkedFriendlyIds = arc.linkedFriendlyIds.filter((id) =>
        validCharacterIds.has(id)
      );

      if (arc.linkedFriendlyIds.length > 0) {
        filteredSnapshots.push(arc);
      } else {
        validationErrors.push(
          `Arc "${arc.tagline}" has no valid character IDs after filtering`
        );
      }
    }

    if (validationErrors.length > 0) {
      ctx.log.error(
        `Validation error in attempt ${attempt}: ${validationErrors.join('; ')}`
      );
    }

    if (validationErrors.length === 0) {
      ctx.log.info(
        `Successfully generated ${filteredSnapshots.length} entity arcs for characters`
      );
      return { snapshots: filteredSnapshots };
    }
  }

  throw new RecoverableError(
    `Reached maximum attempts (${MAX_ATTEMPTS}) with validation errors: ${validationErrors.join('; ')}`
  );
}

async function extractEntityArcsForPlaces(
  {
    entityType,
    entities,
    places
  }: {
    entityType: string;
    entities: EntityInput[];
    places: Array<{ id: string; friendlyId: string; name: string }>;
  },
  ctx: WorkflowContext
) {
  let validationErrors: string[] = [];
  let attempt = 0;

  const userText = extractRelatedPlaceRelationshipArcPrompt.render({
    entityType,
    entities: entities.map((e) => ({
      friendlyId: e.friendlyId,
      name: e.name,
      attributes: e.attributes
    })),
    places: places.map((p) => ({
      friendlyId: p.friendlyId,
      name: p.name
    }))
  });

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    const entityName = entities[0]?.name ?? 'Unknown';
    ctx.log.info(
      `Entity arc extraction (places) attempt ${attempt} of ${MAX_ATTEMPTS} for ${entityName}`
    );

    const { model, apiKey, reasoning } = ctx.getPiModel('piText');
    const message = await ctx.traceComplete(
      'extractEntityArcsForPlaces',
      model,
      { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
      { apiKey, reasoning, sessionId: uuidv7() }
    );
    ctx.trackUsage(message);
    const text = getAssistantText(message);
    const xml = extractWrappedXml(text, 'snapshots');

    if (!xml) {
      ctx.log.warn(`Agent: ${text}`);
      throw new RecoverableError('No snapshots found in response');
    }
    ctx.log.info(`Agent: captured <snapshots> (length: ${xml.length})`);

    const ast = parse(xml);
    const snapshotNodes = querySelectorAll(ast, 'snapshot');

    const data = {
      snapshots: snapshotNodes.map((snapshot) => ({
        entityFriendlyId: getAttribute(snapshot, 'entity_id') ?? '',
        linkedFriendlyIds: querySelectorAll(snapshot, 'place_id').map((p) =>
          getText(p).trim()
        ),
        tagline: getText(querySelector(snapshot, 'tagline')).trim(),
        chapters: getText(querySelector(snapshot, 'chapters')).trim(),
        detail: getText(querySelector(snapshot, 'detail')).trim()
      }))
    };

    const validatedData = v.safeParse(EntityArcOutputSchema, data);

    if (!validatedData.success) {
      ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
      throw new RecoverableError(
        `Failed to parse entity arc snapshots: ${v.summarize(validatedData.issues)}`
      );
    }

    if (validatedData.output.snapshots.length === 0) {
      ctx.log.warn('No snapshots found in response');
      return { snapshots: [] };
    }

    for (const arc of validatedData.output.snapshots) {
      arc.linkedFriendlyIds = [...new Set(arc.linkedFriendlyIds)];
    }

    validationErrors = [];
    const validEntityIds = new Set(entities.map((e) => e.friendlyId));
    const validPlaceIds = new Set(places.map((p) => p.friendlyId));

    const filteredSnapshots = [];
    for (const arc of validatedData.output.snapshots) {
      if (!validEntityIds.has(arc.entityFriendlyId)) {
        validationErrors.push(
          `Snapshot references invalid entity ID: ${arc.entityFriendlyId}. Valid IDs: ${Array.from(validEntityIds).join(', ')}`
        );
        continue;
      }

      // Filter out invalid place IDs, keeping valid ones
      const invalidPlaces = arc.linkedFriendlyIds.filter((id) => !validPlaceIds.has(id));
      if (invalidPlaces.length > 0) {
        ctx.log.warn(
          `Arc "${arc.tagline}" references unknown place IDs (filtered out): ${invalidPlaces.join(', ')}`
        );
      }

      arc.linkedFriendlyIds = arc.linkedFriendlyIds.filter((id) => validPlaceIds.has(id));

      if (arc.linkedFriendlyIds.length > 0) {
        filteredSnapshots.push(arc);
      } else {
        validationErrors.push(
          `Arc "${arc.tagline}" has no valid place IDs after filtering`
        );
      }
    }

    if (validationErrors.length > 0) {
      ctx.log.error(
        `Validation error in attempt ${attempt}: ${validationErrors.join('; ')}`
      );
    }

    if (validationErrors.length === 0) {
      ctx.log.info(
        `Successfully generated ${filteredSnapshots.length} entity arcs for places`
      );
      return { snapshots: filteredSnapshots };
    }
  }

  throw new RecoverableError(
    `Reached maximum attempts (${MAX_ATTEMPTS}) with validation errors: ${validationErrors.join('; ')}`
  );
}
