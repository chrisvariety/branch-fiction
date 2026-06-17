import {
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { watchAgent } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { Agent } from '@earendil-works/pi-agent-core';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { NewBookArc } from '@/app/lib/db/types';
import { getDb } from '@/lib/db';
import { createBookArcs } from '@/lib/db/models/book-arc/create-book-arc';
import {
  generateUniqueArcFriendlyPrefix,
  getBookArcsWithEntitiesByBookIdAndType
} from '@/lib/db/models/book-arc/get-book-arc';
import { getBookEntitiesByBookIdAndTypesAndSignificanceTiers } from '@/lib/db/models/book-entity/get-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getNonEmptyChapterParagraphsByBookId } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { getChapterRelationshipsWithChapterAndEntitiesByBookId } from '@/lib/db/models/chapter-relationship/get-chapter-relationship';
import {
  getChapterByBookIdAndChapterIdx,
  getMaxChapterIdxByBookId
} from '@/lib/db/models/chapter/get-chapter';
import { parseChapterRange } from '@/lib/lit/chapter-range';
import { SignificanceTier } from '@/lib/lit/entity-significance';
import { isolateArcs } from '@/lib/lit/isolate-arcs';
import {
  createLookupRelatedEntityAppearanceTool,
  getRelatedEntitiesFromArcs
} from '@/lib/lit/related-entities';
import { clusterCharactersByHub } from '@/lib/lit/relationship-graph';
import { estimateTokens } from '@/lib/llm/estimate-tokens';
import extractRelationshipArcPrompt from '@/lib/prompts/post-processing/extract-relationship-arc';
import { reportStepProgress } from '@/lib/step-projection';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

const MAX_ATTEMPTS = 3;

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
      `Extract Relationship Arc ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
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
      .info('Starting relationship arc extraction');

    await ctx.narrate('Now tracing how those relationships evolve chapter by chapter.');

    const allParagraphs = await getNonEmptyChapterParagraphsByBookId(book.id);
    const bookTokens = allParagraphs.reduce(
      (sum, p) => sum + estimateTokens(p.content),
      0
    );

    // Check if relationship arcs already exist and extract covered character IDs
    const existingArcs = await getBookArcsWithEntitiesByBookIdAndType(
      book.id,
      'RELATIONSHIP'
    );

    // Extract unique character IDs that already have relationship arc coverage
    const coveredCharacterIds = new Set(
      existingArcs.flatMap((arc) => arc.bookEntities.map((entity) => entity.id))
    );

    ctx.log.info(
      `Found ${existingArcs.length} existing relationship arcs covering ${coveredCharacterIds.size} unique characters`
    );

    // Fetch all CHARACTER entities for the book with specified significance tiers
    const characters = await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
      book.id,
      ['CHARACTER'],
      significanceTiers
    );

    if (characters.length === 0) {
      ctx.log.info('No CHARACTER entities found for relationship arc extraction');
      return {
        bookId: book.id,
        arcsCreated: 0
      };
    }

    ctx.log.info(
      `Found ${characters.length} CHARACTER entities to analyze for relationship arcs`
    );

    // Identify new characters that don't have relationship arc coverage yet
    const newCharacterIds = new Set(
      characters.filter((c) => !coveredCharacterIds.has(c.id)).map((c) => c.id)
    );

    if (newCharacterIds.size === 0) {
      ctx.log.info(
        'All CHARACTER entities already have relationship arc coverage - skipping extraction'
      );
      return {
        bookId: book.id,
        arcsCreated: 0
      };
    }

    ctx.log.info(
      `Found ${newCharacterIds.size} new CHARACTER entities without relationship arc coverage`
    );

    // Fetch all relationships for the book
    const allRelationships = (
      await getChapterRelationshipsWithChapterAndEntitiesByBookId(book.id)
    ).sort((a, b) => a.chapter.idx - b.chapter.idx);

    if (allRelationships.length === 0) {
      ctx.log.info('No relationships found for relationship arc extraction');
      return {
        bookId: book.id,
        arcsCreated: 0
      };
    }

    ctx.log.info(`Found ${allRelationships.length} relationships to analyze`);

    // Filter relationships to only include those between selected characters
    const characterIds = new Set(characters.map((c) => c.id));
    const relevantRelationships = allRelationships.filter(
      (rel) =>
        rel.sourceEntity.type === 'CHARACTER' &&
        rel.targetEntity.type === 'CHARACTER' &&
        characterIds.has(rel.sourceEntity.id) &&
        characterIds.has(rel.targetEntity.id)
    );

    if (relevantRelationships.length === 0) {
      ctx.log.info('No relationships found between selected characters');
      return {
        bookId: book.id,
        arcsCreated: 0
      };
    }

    ctx.log.info(
      `Found ${relevantRelationships.length} relationships between selected characters`
    );

    // Create clusters from all characters (before filtering to new characters)
    const clusters = clusterCharactersByHub(
      relevantRelationships,
      characters.map((c) => ({ id: c.id, name: c.name, type: c.type }))
    );

    ctx.log.info(
      `Created ${clusters.length} character clusters:\n${clusters
        .map(
          (cluster, idx) =>
            `  Cluster ${idx + 1} [${cluster.clusterType}${cluster.label ? `: ${cluster.label}` : ''}]: ${cluster.characters.map((c) => c.name).join(', ')}`
        )
        .join('\n')}`
    );

    type ArcSnapshot = {
      characters: string[];
      phase: string;
      chapters: string;
      detail: string;
      clusterSize: number; // Number of characters in the source cluster
    };
    const arcSetsByEntitySet = new Map<string, ArcSnapshot[]>();

    // Helper to compute focus score - lower is better (0 = cluster exactly matches arc characters)
    const getArcSetFocus = (arcs: ArcSnapshot[]) => {
      const arc = arcs[0]; // All arcs in a set come from the same cluster
      return arc.clusterSize - arc.characters.length;
    };

    // Helper to get entity set key from arc character friendlyIds
    const friendlyIdToId = new Map(characters.map((c) => [c.friendlyId, c.id]));
    const getEntitySetKey = (arc: ArcSnapshot) => {
      const arcCharacterIds = arc.characters
        .map((friendlyId) => friendlyIdToId.get(friendlyId))
        .filter((id): id is string => id !== undefined);
      return arcCharacterIds.sort().join(',');
    };

    // Process each cluster separately
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const clusterCharacterIds = new Set(cluster.characters.map((c) => c.id));

      ctx.log.info(
        `Processing cluster ${i + 1}/${clusters.length} [${cluster.clusterType}]: ${cluster.characters.map((c) => c.name).join(', ')}`
      );

      // Filter relationships to only those involving cluster characters
      const clusterRelationships = relevantRelationships.filter(
        (rel) =>
          clusterCharacterIds.has(rel.sourceEntity.id) &&
          clusterCharacterIds.has(rel.targetEntity.id)
      );

      if (clusterRelationships.length === 0) {
        ctx.log.info(`Cluster ${i + 1} has no relationships, skipping`);
        continue;
      }

      const relationships = clusterRelationships.map(
        (rel) =>
          `(${rel.sourceEntity.friendlyId})-[:${rel.predicateType} {chapter: ${rel.chapter.idx}, description: "${rel.predicateDescription}"}]->(${rel.targetEntity.friendlyId})`
      );

      // Gather mentions from the cluster relationships
      const relationshipsText = relationships.join(' ');
      const relatedEntitiesResult = await getRelatedEntitiesFromArcs({
        bookId: book.id,
        bookEntityIds: cluster.characters.map((c) => c.id),
        searchTextForMentions: relationshipsText
      });

      ctx.log.info(
        `Cluster ${i + 1}: ${clusterRelationships.length} relationships, ${relatedEntitiesResult.entities.length} related entities`
      );

      const clusterCharacters = cluster.characters
        .map((c) => characters.find((char) => char.id === c.id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);

      const relationshipArcResult = await extractRelationshipArc(
        {
          book,
          characters: clusterCharacters.map((c) => ({
            id: c.id,
            friendlyId: c.friendlyId,
            name: c.name,
            description: c.description
          })),
          relationships,
          relatedEntities:
            relatedEntitiesResult.entities.length > 0
              ? relatedEntitiesResult.entities
              : undefined,
          contextEntityIds: relatedEntitiesResult.contextEntityIds
        },
        ctx
      );

      ctx.log.info(
        `Cluster ${i + 1} generated ${relationshipArcResult.snapshots.length} relationship arcs`
      );

      // Group this cluster's arcs by character set, tagging with cluster size
      const clusterSize = cluster.characters.length;
      const clusterArcsByEntitySet = new Map<string, ArcSnapshot[]>();
      for (const snapshot of relationshipArcResult.snapshots) {
        const arc: ArcSnapshot = { ...snapshot, clusterSize };
        const key = getEntitySetKey(arc);
        const existing = clusterArcsByEntitySet.get(key);
        if (!existing) {
          clusterArcsByEntitySet.set(key, [arc]);
        } else {
          existing.push(arc);
        }
      }

      // For each character set from this cluster, compare with existing and keep the more focused set
      for (const [entitySetKey, clusterArcs] of clusterArcsByEntitySet) {
        const existingArcs = arcSetsByEntitySet.get(entitySetKey);

        if (!existingArcs) {
          // First time seeing this character set
          arcSetsByEntitySet.set(entitySetKey, clusterArcs);
        } else {
          // Compare focus scores - lower is better (cluster size closer to arc character count)
          const existingFocus = getArcSetFocus(existingArcs);
          const clusterFocus = getArcSetFocus(clusterArcs);

          if (clusterFocus < existingFocus) {
            // New cluster is more focused, use it
            ctx.log.info(
              `Cluster ${i + 1}: Replacing arc set for character set (focus ${clusterFocus}, ${clusterArcs.length} arcs) over existing (focus ${existingFocus}, ${existingArcs.length} arcs)`
            );
            arcSetsByEntitySet.set(entitySetKey, clusterArcs);
          } else if (clusterFocus === existingFocus) {
            // Same focus - use content length as tiebreaker
            const existingLength = existingArcs.reduce(
              (sum, a) => sum + a.detail.length,
              0
            );
            const clusterLength = clusterArcs.reduce(
              (sum, a) => sum + a.detail.length,
              0
            );
            if (clusterLength > existingLength) {
              ctx.log.info(
                `Cluster ${i + 1}: Replacing arc set for character set (same focus ${clusterFocus}, ${clusterLength} chars) over existing (${existingLength} chars)`
              );
              arcSetsByEntitySet.set(entitySetKey, clusterArcs);
            }
          }
        }
      }

      reportStepProgress(ctx, {
        stepId: 'extract_relationship_arc',
        stepStartMs,
        fractionOfStepComplete: (i + 1) / clusters.length,
        bookTokens
      });
    }

    // Flatten all arc sets into final list, stripping clusterSize (only needed for comparison)
    const deduplicatedArcs = Array.from(arcSetsByEntitySet.values())
      .flat()
      .map(({ clusterSize: _, ...arc }) => arc);

    ctx.log.info(
      `Total ${deduplicatedArcs.length} relationship arcs from ${arcSetsByEntitySet.size} unique character sets`
    );

    // Filter to only arcs involving at least one new character
    const filteredArcs = deduplicatedArcs.filter((arc) => {
      // Map character friendlyIds to IDs for this arc
      const arcCharacterIds = arc.characters
        .map((fid) => friendlyIdToId.get(fid))
        .filter((id): id is string => id !== undefined);

      // Include arc if at least one character is new
      return arcCharacterIds.some((id) => newCharacterIds.has(id));
    });

    ctx.log.info(
      `Filtered to ${filteredArcs.length} relationship arcs involving new characters`
    );

    if (filteredArcs.length === 0) {
      ctx.log.info('No relationship arcs involve new characters - skipping insertion');
      return {
        bookId: book.id,
        arcsCreated: 0
      };
    }

    const maxChapterIdx = await getMaxChapterIdxByBookId(book.id);

    // Create book arcs and link to involved characters
    const arcsToInsert: Array<
      Omit<NewBookArc, 'friendlyIdPrefix' | 'friendlyId' | 'friendlyIdIdx'>
    > = [];

    for (const arc of filteredArcs) {
      // Parse chapter range from the chapters string
      const chapterRange = parseChapterRange(arc.chapters, maxChapterIdx);

      // Get chapter IDs for the arc range
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
          `Could not find chapters for range ${chapterRange.startChapterIdx}-${chapterRange.endChapterIdx} in arc "${arc.phase}"`
        );
      }

      // Map character friendlyIds to IDs
      const characterIds = arc.characters
        .map((fid) => friendlyIdToId.get(fid))
        .filter((id): id is string => id !== undefined);

      if (characterIds.length !== arc.characters.length) {
        const missingCharacters = arc.characters.filter(
          (fid) => !friendlyIdToId.has(fid)
        );
        throw new RecoverableError(
          `Could not find character IDs for: ${missingCharacters.join(', ')}`
        );
      }

      arcsToInsert.push({
        id: uuidv7(),
        bookId: book.id,
        type: 'RELATIONSHIP',
        startChapterId: startChapter.id,
        endChapterId: endChapter.id,
        title: arc.phase,
        content: arc.detail,
        bookEntityIds: characterIds
      });
    }

    // Group arcs by entity IDs to batch insert with same prefix
    const arcsByEntityIds = new Map<string, typeof arcsToInsert>();
    for (const arc of arcsToInsert) {
      const key = arc.bookEntityIds.sort().join(',');
      if (!arcsByEntityIds.has(key)) {
        arcsByEntityIds.set(key, []);
      }
      arcsByEntityIds.get(key)!.push(arc);
    }

    // Insert arcs and link to characters in a transaction
    const createdArcs = await getDb()
      .transaction()
      .execute(async (trx) => {
        const allArcs: Awaited<ReturnType<typeof createBookArcs>> = [];

        // Process each group of arcs with the same entity IDs
        for (const arcsGroup of arcsByEntityIds.values()) {
          // Generate prefix for this group
          const friendlyIdPrefix = await generateUniqueArcFriendlyPrefix({
            bookId: book.id,
            arcType: 'RELATIONSHIP',
            entityIds: arcsGroup[0].bookEntityIds,
            trx
          });

          const arcs = await createBookArcs(arcsGroup, friendlyIdPrefix, trx);

          allArcs.push(...arcs);
        }

        return allArcs;
      });

    ctx.log.info(`Created ${createdArcs.length} relationship arc snapshots`);

    // Isolate arcs inline — group by friendlyIdPrefix since each entity group has its own
    const arcsByPrefix = new Map<string, typeof createdArcs>();
    for (const arc of createdArcs) {
      const existing = arcsByPrefix.get(arc.friendlyIdPrefix) || [];
      existing.push(arc);
      arcsByPrefix.set(arc.friendlyIdPrefix, existing);
    }
    for (const groupArcs of arcsByPrefix.values()) {
      await isolateArcs(
        {
          arcType: 'RELATIONSHIP',
          arcs: groupArcs,
          bookId: book.id,
          bookTitle: book.title
        },
        ctx
      );
    }

    return {
      bookId: book.id,
      arcsCreated: createdArcs.length
    };
  }
);

const RelationshipArcOutputSchema = v.object({
  snapshots: v.array(
    v.object({
      characters: v.array(v.string()),
      phase: v.string(),
      chapters: v.string(),
      detail: v.string()
    })
  )
});

async function extractRelationshipArc(
  {
    book,
    characters,
    relationships,
    relatedEntities,
    contextEntityIds
  }: {
    book: { id: string; title: string };
    characters: Array<{
      id: string;
      friendlyId: string;
      name: string;
      description: string | null | undefined;
    }>;
    relationships: string[];
    relatedEntities?: {
      friendlyId: string;
      name: string;
      type: string;
      summary: string;
      phrasesUsed?: string;
    }[];
    contextEntityIds: string[];
  },
  ctx: WorkflowContext
) {
  let validationErrors: string[] = [];
  let attempt = 0;

  const userText = extractRelationshipArcPrompt.render({
    characters: characters.map((c) => ({
      friendlyId: c.friendlyId,
      name: c.name,
      description: c.description ?? undefined
    })),
    relationships,
    relatedEntities
  });

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    ctx.log.info(`Relationship arc extraction attempt ${attempt} of ${MAX_ATTEMPTS}`);

    const { model, apiKey, reasoning } = ctx.getPiModel('piText');
    const agent = new Agent({
      sessionId: uuidv7(),
      initialState: {
        model,
        thinkingLevel: reasoning,
        tools: [
          createLookupRelatedEntityAppearanceTool(book.id, contextEntityIds, 'general')
        ]
      },
      getApiKey: () => apiKey
    });

    const watcher = watchAgent('extractRelationshipArc', agent, ctx, 'snapshots');

    try {
      await agent.prompt(userText);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        ctx.log.warn('Extract relationship arc aborted');
      } else {
        throw e;
      }
    }

    if (agent.state.errorMessage) {
      ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
    }

    if (!watcher.xml) {
      throw new RecoverableError('No snapshots found in response');
    }

    const ast = parse(watcher.xml);
    const snapshotNodes = querySelectorAll(ast, 'snapshot');

    const data = {
      snapshots: snapshotNodes.map((snapshot) => ({
        characters: querySelectorAll(snapshot, 'character_id').map((c) =>
          getText(c).trim()
        ),
        phase: getText(querySelector(snapshot, 'phase')).trim(),
        chapters: getText(querySelector(snapshot, 'chapters')).trim(),
        detail: getText(querySelector(snapshot, 'detail')).trim()
      }))
    };

    const validatedData = v.safeParse(RelationshipArcOutputSchema, data);

    if (!validatedData.success) {
      ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
      throw new RecoverableError(
        `Failed to parse relationship arc snapshots: ${v.summarize(validatedData.issues)}`
      );
    }

    if (validatedData.output.snapshots.length === 0) {
      console.warn('No snapshots found in response');
      return { snapshots: [] };
    }

    // Deduplicate character IDs in each arc
    for (const arc of validatedData.output.snapshots) {
      arc.characters = [...new Set(arc.characters)];
    }

    // Validate that all character IDs in arcs exist in the input
    validationErrors = [];
    const validCharacterFriendlyIds = new Set(characters.map((c) => c.friendlyId));

    for (const arc of validatedData.output.snapshots) {
      const invalidCharacters = arc.characters.filter(
        (id) => !validCharacterFriendlyIds.has(id)
      );

      if (invalidCharacters.length > 0) {
        validationErrors.push(
          `Arc "${arc.phase}" references invalid character IDs: ${invalidCharacters.join(', ')}. All character IDs must match the input characters.`
        );
      }
    }

    if (validationErrors.length > 0) {
      ctx.log.error(
        `Validation error in attempt ${attempt}: ${validationErrors.join('; ')}`
      );
    }

    if (validationErrors.length === 0) {
      // Success! Break out of the retry loop
      ctx.log.info(
        `Successfully generated ${validatedData.output.snapshots.length} relationship arcs`
      );
      return validatedData.output;
    }
  }

  throw new RecoverableError(
    `Reached maximum attempts (${MAX_ATTEMPTS}) with validation errors: ${validationErrors.join('; ')}`
  );
}
