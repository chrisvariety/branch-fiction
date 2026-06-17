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

import { getDb } from '@/lib/db';
import { getBookArcsByBookIdAndTypesAndEntityIds } from '@/lib/db/models/book-arc/get-book-arc';
import { getBookEntitiesWithSummariesByBookIdAndTypesAndSignificanceTiers } from '@/lib/db/models/book-entity/get-book-entity';
import { updateBookEntityById } from '@/lib/db/models/book-entity/update-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getChapterRelationshipsWithChapterAndEntitiesByBookId } from '@/lib/db/models/chapter-relationship/get-chapter-relationship';
import { getChapterById } from '@/lib/db/models/chapter/get-chapter';
import {
  buildRelationshipGraph,
  findAnchorCharacterIds
} from '@/lib/lit/relationship-graph';
import summarizeCharacterAnchorIdentityTagPrompt from '@/lib/prompts/post-processing/summarize-character-anchor-identity-tag';
import summarizeCharacterIdentityTagPrompt from '@/lib/prompts/post-processing/summarize-character-identity-tag';
import summarizeCharacterOrphanIdentityTagPrompt from '@/lib/prompts/post-processing/summarize-character-orphan-identity-tag';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

// Percentage of data to include for identity tag generation (0-1)
const ANCHOR_CHARACTER_RELATIONSHIP_PERCENTAGE = 0.75;
const RELATIONSHIP_ARC_PERCENTAGE = 0.75;

const MAX_IDENTITY_TAG_ATTEMPTS = 3;

export const handler = createWorkflowFunction<
  {
    bookId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
  },
  { bookId: string; charactersUpdated: number }
>(
  {
    name: ({ book }, retryCount) =>
      `Generate Identity Tags ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      return { book };
    },
    check: async (_payload, result) => ({
      passed: result.charactersUpdated > 0,
      severity: 'WARN' as const,
      metadata: {
        charactersUpdated: result.charactersUpdated
      }
    })
  },
  async ({ book }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title
      })
      .info('Starting identity tag generation');

    await ctx.narrate('Writing a one-line identity tag for each main character.');

    const characterResults = await generateCharacterIdentityTags(book, ctx);

    ctx.log.info(`Generated ${characterResults.updatedCount} character tags`);

    return {
      bookId: book.id,
      charactersUpdated: characterResults.updatedCount
    };
  }
);

const CharacterIdentityTagOutputSchema = v.object({
  identity_tag: v.string()
});

const CharacterIdentityTagBatchOutputSchema = v.object({
  identity_tags: v.array(
    v.object({
      id: v.string(),
      identity_tag: v.string()
    })
  )
});

async function generateCharacterIdentityTags(
  book: { id: string; title: string },
  ctx: WorkflowContext
) {
  const characters =
    await getBookEntitiesWithSummariesByBookIdAndTypesAndSignificanceTiers(
      book.id,
      ['CHARACTER'],
      ['PRIMARY']
    );

  if (characters.length === 0) {
    ctx.log.info('No PRIMARY characters found for identity tag generation');
    return { updatedCount: 0 };
  }

  ctx.log.info(`Found ${characters.length} PRIMARY characters for identity tags`);

  // Build relationship graph to determine anchor characters
  const allRelationships = await getChapterRelationshipsWithChapterAndEntitiesByBookId(
    book.id
  );

  const graph = buildRelationshipGraph(allRelationships);

  const anchorCharacterIds = findAnchorCharacterIds(graph);

  const anchorCharacterNames = [...anchorCharacterIds]
    .map((id) => graph.getNodeAttribute(id, 'entity').name)
    .filter(Boolean);

  ctx.log.info(
    `Identified ${anchorCharacterIds.size} anchor characters: ${anchorCharacterNames.join(', ')}`
  );

  // For each non-anchor character, find their most-connected anchor character
  const characterToAnchor = new Map<
    string,
    { id: string; name: string; description?: string }
  >();

  for (const character of characters) {
    if (anchorCharacterIds.has(character.id)) {
      // This character IS an anchor, no need for an anchor relationship
      continue;
    }

    if (!graph.hasNode(character.id)) {
      continue;
    }

    // Find the anchor character this character has the most relationships with
    const neighborCounts = new Map<string, number>();
    graph.forEachEdge(character.id, (_edge, _attrs, source, target) => {
      const neighborId = source === character.id ? target : source;
      if (anchorCharacterIds.has(neighborId)) {
        neighborCounts.set(neighborId, (neighborCounts.get(neighborId) || 0) + 1);
      }
    });

    if (neighborCounts.size > 0) {
      // Find the anchor with most connections
      const sortedAnchors = Array.from(neighborCounts.entries()).sort(
        (a, b) => b[1] - a[1]
      );
      const topAnchorId = sortedAnchors[0][0];
      const anchorEntity = graph.getNodeAttribute(topAnchorId, 'entity');

      // Find the anchor in our characters list to get description
      const anchorCharacter = characters.find((c) => c.id === topAnchorId);

      characterToAnchor.set(character.id, {
        id: topAnchorId,
        name: anchorEntity.name,
        description: anchorCharacter?.description
          ? anchorCharacter.description
          : undefined
      });
    }
  }

  const identityTagResults: Array<{ characterId: string; identityTag: string }> = [];

  // 1. Generate identity tags for anchor characters (one at a time)
  for (const character of characters) {
    if (!anchorCharacterIds.has(character.id)) {
      continue;
    }

    if (character.identityTag) {
      ctx.log.info(
        `Anchor character ${character.name} already has identity tag, skipping`
      );
      continue;
    }

    const relationships = getAnchorCharacterRelationshipsForIdentityTag(
      allRelationships,
      character.id
    );
    if (relationships.length === 0) {
      ctx.log.warn(`Anchor character ${character.name} has no relationships, skipping`);
      continue;
    }

    ctx.log.info(
      `Generating identity tag for anchor character ${character.name} with ${relationships.length} relationships`
    );

    const identityTag = await generateAnchorCharacterIdentityTag(
      {
        character: {
          name: character.name,
          relationships
        }
      },
      ctx
    );

    identityTagResults.push({ characterId: character.id, identityTag });
  }

  // 2. Group supporting characters by their anchor, then batch generate
  const anchorToCharacters = new Map<
    string,
    Array<{
      id: string;
      friendlyId: string;
      name: string;
      relationshipArcs?: Arc[];
      characterArcs?: Arc[];
    }>
  >();

  for (const character of characters) {
    const anchor = characterToAnchor.get(character.id);
    if (!anchor) {
      continue;
    }

    if (character.identityTag) {
      ctx.log.info(`Character ${character.name} already has identity tag, skipping`);
      continue;
    }

    const arcs = await getSupportingCharacterArcsForIdentityTag(
      book.id,
      character.id,
      anchor.id,
      character.minorUntilChapterId
    );

    if (!arcs.relationshipArcs && !arcs.characterArcs) {
      ctx.log.warn(`Character ${character.name} has no arcs, skipping`);
      continue;
    }

    const existing = anchorToCharacters.get(anchor.id) || [];
    existing.push({
      id: character.id,
      friendlyId: character.friendlyId,
      name: character.name,
      ...arcs
    });
    anchorToCharacters.set(anchor.id, existing);
  }

  // Generate batched identity tags for each anchor's supporting characters
  for (const [anchorId, supportingCharacters] of anchorToCharacters) {
    const anchor = characters.find((c) => c.id === anchorId);
    if (!anchor) {
      continue;
    }

    ctx.log.info(
      `Generating identity tags for ${supportingCharacters.length} characters anchored to ${anchor.name}`
    );

    const batchResults = await generateSupportingCharacterIdentityTags(
      {
        characters: supportingCharacters.map((c) => ({
          friendlyId: c.friendlyId,
          name: c.name,
          relationshipArcs: c.relationshipArcs,
          characterArcs: c.characterArcs
        })),
        anchorCharacter: {
          name: anchor.name,
          friendlyId: anchor.friendlyId
        }
      },
      ctx
    );

    const friendlyIdToId = new Map(supportingCharacters.map((c) => [c.friendlyId, c.id]));
    for (const result of batchResults) {
      const characterId = friendlyIdToId.get(result.id);
      if (characterId) {
        identityTagResults.push({ characterId, identityTag: result.identity_tag });
      } else {
        ctx.log.warn(`Could not find character for id: ${result.id}`);
      }
    }
  }

  // 3. Handle orphan characters (not anchors, not assigned to any anchor)
  const processedCharacterIds = new Set(identityTagResults.map((r) => r.characterId));
  const orphanCharacters = characters.filter(
    (c) =>
      !anchorCharacterIds.has(c.id) &&
      !characterToAnchor.has(c.id) &&
      !c.identityTag &&
      !processedCharacterIds.has(c.id)
  );

  if (orphanCharacters.length > 0) {
    const orphansWithArcs: Array<{
      id: string;
      friendlyId: string;
      name: string;
      characterArcs: Arc[];
    }> = [];

    for (const character of orphanCharacters) {
      const characterArcs = await getCharacterArcsForIdentityTag(
        book.id,
        character.id,
        character.minorUntilChapterId
      );

      if (characterArcs.length > 0) {
        orphansWithArcs.push({
          id: character.id,
          friendlyId: character.friendlyId,
          name: character.name,
          characterArcs
        });
      } else {
        ctx.log.warn(
          `Orphan character ${character.name} has no character arcs, skipping`
        );
      }
    }

    if (orphansWithArcs.length > 0) {
      ctx.log.info(
        `Generating identity tags for ${orphansWithArcs.length} orphan characters using character arcs`
      );

      const batchResults = await generateOrphanCharacterIdentityTags(
        {
          characters: orphansWithArcs.map((c) => ({
            friendlyId: c.friendlyId,
            name: c.name,
            characterArcs: c.characterArcs
          }))
        },
        ctx
      );

      const friendlyIdToId = new Map(orphansWithArcs.map((c) => [c.friendlyId, c.id]));
      for (const result of batchResults) {
        const characterId = friendlyIdToId.get(result.id);
        if (characterId) {
          identityTagResults.push({ characterId, identityTag: result.identity_tag });
        } else {
          ctx.log.warn(`Could not find orphan character for id: ${result.id}`);
        }
      }
    }
  }

  if (identityTagResults.length > 0) {
    await getDb()
      .transaction()
      .execute(async (trx) => {
        for (const { characterId, identityTag } of identityTagResults) {
          await updateBookEntityById(characterId, { identityTag }, trx);
        }
      });
  }

  return { updatedCount: identityTagResults.length };
}

async function generateAnchorCharacterIdentityTag(
  {
    character
  }: {
    character: { name: string; relationships: string[] };
  },
  ctx: WorkflowContext
) {
  const userText = summarizeCharacterAnchorIdentityTagPrompt.render({ character });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const message = await ctx.traceComplete(
    'generateAnchorCharacterIdentityTag',
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const text = getAssistantText(message);
  const xml = extractWrappedXml(text, 'identity_tag');

  if (!xml) {
    ctx.log.warn(`Agent: ${text}`);
    throw new RecoverableError('No identity_tag found in response');
  }
  ctx.log.info(`Agent: captured <identity_tag> (length: ${xml.length})`);

  const ast = parse(xml);
  const tagNode = querySelector(ast, 'identity_tag');
  const data = {
    identity_tag: getText(tagNode).trim()
  };

  const parsed = v.parse(CharacterIdentityTagOutputSchema, data);
  return parsed.identity_tag;
}

async function extractIdentityTagsBatch(
  userText: string,
  ctx: WorkflowContext
): Promise<Array<{ id: string; identity_tag: string }>> {
  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const message = await ctx.traceComplete(
    'extractIdentityTagsBatch',
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const text = getAssistantText(message);
  const xml = extractWrappedXml(text, 'identity_tags');

  if (!xml) {
    ctx.log.warn(`Agent: ${text}`);
    throw new RecoverableError('No identity_tags found in response');
  }
  ctx.log.info(`Agent: captured <identity_tags> (length: ${xml.length})`);

  const ast = parse(xml);
  const tagNodes = querySelectorAll(ast, 'identity_tag');

  const data = {
    identity_tags: tagNodes.map((node) => ({
      id: getAttribute(node, 'id') || '',
      identity_tag: getText(node).trim()
    }))
  };

  const validatedData = v.safeParse(CharacterIdentityTagBatchOutputSchema, data);

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse identity tags: ${v.summarize(validatedData.issues)}`
    );
  }

  return validatedData.output.identity_tags;
}

async function generateSupportingCharacterIdentityTags(
  {
    characters,
    anchorCharacter
  }: {
    characters: Array<{
      friendlyId: string;
      name: string;
      relationshipArcs?: Arc[];
      characterArcs?: Arc[];
    }>;
    anchorCharacter: { name: string; friendlyId: string };
  },
  ctx: WorkflowContext
) {
  const expectedIds = new Set(characters.map((c) => c.friendlyId));

  const userText = summarizeCharacterIdentityTagPrompt.render({
    characters,
    anchorCharacter
  });

  for (let attempt = 1; attempt <= MAX_IDENTITY_TAG_ATTEMPTS; attempt++) {
    const identityTags = await extractIdentityTagsBatch(userText, ctx);

    const { valid, missingIds, invalidIds } = validateBatchIdentityTagIds(
      identityTags,
      expectedIds
    );

    if (valid) {
      return identityTags;
    }

    ctx.log.warn(
      `Supporting identity tag ID mismatch (attempt ${attempt}/${MAX_IDENTITY_TAG_ATTEMPTS})` +
        (missingIds.length > 0 ? `, missing: ${missingIds.join(', ')}` : '') +
        (invalidIds.length > 0 ? `, invalid: ${invalidIds.join(', ')}` : '')
    );
  }

  throw new RecoverableError(
    `Failed to get valid supporting identity tag IDs after ${MAX_IDENTITY_TAG_ATTEMPTS} attempts`
  );
}

async function generateOrphanCharacterIdentityTags(
  {
    characters
  }: {
    characters: Array<{
      friendlyId: string;
      name: string;
      characterArcs: Arc[];
    }>;
  },
  ctx: WorkflowContext
) {
  const expectedIds = new Set(characters.map((c) => c.friendlyId));

  const userText = summarizeCharacterOrphanIdentityTagPrompt.render({ characters });

  for (let attempt = 1; attempt <= MAX_IDENTITY_TAG_ATTEMPTS; attempt++) {
    const identityTags = await extractIdentityTagsBatch(userText, ctx);

    const { valid, missingIds, invalidIds } = validateBatchIdentityTagIds(
      identityTags,
      expectedIds
    );

    if (valid) {
      return identityTags;
    }

    ctx.log.warn(
      `Orphan identity tag ID mismatch (attempt ${attempt}/${MAX_IDENTITY_TAG_ATTEMPTS})` +
        (missingIds.length > 0 ? `, missing: ${missingIds.join(', ')}` : '') +
        (invalidIds.length > 0 ? `, invalid: ${invalidIds.join(', ')}` : '')
    );
  }

  throw new RecoverableError(
    `Failed to get valid orphan identity tag IDs after ${MAX_IDENTITY_TAG_ATTEMPTS} attempts`
  );
}

async function getCharacterArcsForIdentityTag(
  bookId: string,
  entityId: string,
  minorUntilChapterId: string | null
): Promise<Array<{ title: string; content: string }>> {
  const arcs = await getBookArcsByBookIdAndTypesAndEntityIds(
    bookId,
    ['CHARACTER'],
    [entityId],
    { includeChapters: true }
  );

  if (arcs.length === 0) {
    return [];
  }

  let startIdx = 0;

  if (minorUntilChapterId) {
    const minorUntilChapter = await getChapterById(minorUntilChapterId);
    if (minorUntilChapter) {
      // Find the first arc that starts at or after minorUntilChapterId
      const minorUntilIdx = minorUntilChapter.idx;
      const foundIdx = arcs.findIndex(
        (arc) =>
          (arc as { startChapterIdx?: number }).startChapterIdx !== undefined &&
          (arc as { startChapterIdx: number }).startChapterIdx >= minorUntilIdx
      );
      if (foundIdx !== -1) {
        startIdx = foundIdx;
      }
    }
  }

  // Take configured percentage of arcs from the starting point (rounded up, minimum 1)
  const availableArcs = arcs.length - startIdx;
  const arcCount = Math.max(1, Math.ceil(availableArcs * RELATIONSHIP_ARC_PERCENTAGE));
  return arcs.slice(startIdx, startIdx + arcCount).map((arc) => ({
    title: arc.title,
    content: arc.content
  }));
}

function getAnchorCharacterRelationshipsForIdentityTag(
  allRelationships: Awaited<
    ReturnType<typeof getChapterRelationshipsWithChapterAndEntitiesByBookId>
  >,
  entityId: string
): string[] {
  // Filter to relationships where this entity is source or target
  const characterRelationships = allRelationships.filter(
    (rel) => rel.sourceEntity.id === entityId || rel.targetEntity.id === entityId
  );

  if (characterRelationships.length === 0) {
    return [];
  }

  // Sort by chapter index to maintain chronological order
  const sorted = characterRelationships.sort((a, b) => a.chapter.idx - b.chapter.idx);

  // Take configured percentage (rounded up, minimum 1)
  const count = Math.max(
    1,
    Math.ceil(sorted.length * ANCHOR_CHARACTER_RELATIONSHIP_PERCENTAGE)
  );
  const selected = sorted.slice(0, count);

  // Format as graph-style strings
  return selected.map(
    (rel) =>
      `(${rel.sourceEntity.name})-[:${rel.predicateType} {chapter: ${rel.chapter.idx}, description: "${rel.predicateDescription}"}]->(${rel.targetEntity.name})`
  );
}

function validateBatchIdentityTagIds(
  results: Array<{ id: string }>,
  expectedIds: Set<string>
): { valid: boolean; missingIds: string[]; invalidIds: string[] } {
  const returnedIds = new Set(results.map((r) => r.id));
  const missingIds = [...expectedIds].filter((id) => !returnedIds.has(id));
  const invalidIds = [...returnedIds].filter((id) => !expectedIds.has(id));

  return {
    valid: missingIds.length === 0 && invalidIds.length === 0,
    missingIds,
    invalidIds
  };
}

type Arc = { title: string; content: string };

async function getSupportingCharacterArcsForIdentityTag(
  bookId: string,
  characterId: string,
  anchorId: string,
  minorUntilChapterId: string | null
): Promise<{ relationshipArcs?: Arc[]; characterArcs?: Arc[] }> {
  // First try to get RELATIONSHIP arcs between this character and the anchor
  const relationshipArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
    bookId,
    ['RELATIONSHIP'],
    [characterId, anchorId],
    { includeChapters: true }
  );

  // Filter to only arcs between exactly these two characters (exclude triangles)
  const filteredRelationshipArcs = relationshipArcs.filter(
    (arc) =>
      arc.bookEntityIds.length === 2 &&
      arc.bookEntityIds.includes(characterId) &&
      arc.bookEntityIds.includes(anchorId)
  );

  if (filteredRelationshipArcs.length > 0) {
    // Take configured percentage of relationship arcs (rounded up, minimum 1)
    const arcCount = Math.max(
      1,
      Math.ceil(filteredRelationshipArcs.length * RELATIONSHIP_ARC_PERCENTAGE)
    );
    return {
      relationshipArcs: filteredRelationshipArcs.slice(0, arcCount).map((arc) => ({
        title: arc.title,
        content: arc.content
      }))
    };
  }

  // Fallback to CHARACTER arcs
  const characterArcs = await getCharacterArcsForIdentityTag(
    bookId,
    characterId,
    minorUntilChapterId
  );

  if (characterArcs.length > 0) {
    return { characterArcs };
  }

  return {};
}
