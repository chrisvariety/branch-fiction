import { Agent } from '@earendil-works/pi-agent-core';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { createBookArcs } from '@/lib/db/models/book-arc/create-book-arc';
import {
  generateUniqueArcFriendlyPrefix,
  getBookArcsByBookIdAndTypesAndEntityIds
} from '@/lib/db/models/book-arc/get-book-arc';
import { getBookEntityById } from '@/lib/db/models/book-entity/get-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import {
  getChapterEntityAttributesByBookEntityId,
  getChapterEntityAttributesByBookEntityIdAndCategories
} from '@/lib/db/models/chapter-entity-attribute/get-chapter-entity-attribute';
import {
  getChapterByBookIdAndChapterIdx,
  getChapterById,
  getMaxChapterIdxByBookId
} from '@/lib/db/models/chapter/get-chapter';
import { RecoverableError, UnrecoverableError } from '@/lib/error-types';
import {
  createLookupCharacterAttributeTool,
  createSearchCharacterAttributesTool
} from '@/lib/lit/attributes';
import { parseChapterRange } from '@/lib/lit/chapter-range';
import { isolateArcs } from '@/lib/lit/isolate-arcs';
import {
  createLookupRelatedEntityAppearanceTool,
  getRelatedEntitiesFromArcs
} from '@/lib/lit/related-entities';
import { getAssistantText, watchAgent } from '@/lib/llm/agent';
import {
  getAttribute,
  extractWrappedXml,
  getInnerHtml,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@/lib/llm/xml';
import determineAppearanceApplicabilityPrompt from '@/lib/prompts/post-processing/determine-appearance-applicability';
import determineEntityArcPrompt from '@/lib/prompts/post-processing/determine-entity-arc';
import extractCharacterAppearancePrompt from '@/lib/prompts/post-processing/extract-character-appearance';
import extractCharacterAppearanceArcPrompt from '@/lib/prompts/post-processing/extract-character-appearance-arc';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

type Attributes = Awaited<
  ReturnType<typeof getChapterEntityAttributesByBookEntityIdAndCategories>
>;

type CharacterWithAttributes = {
  id: string;
  friendlyId: string;
  name: string;
  minorUntilChapterId?: string | null;
  attributes: Attributes;
};

export const handler = createWorkflowFunction<
  {
    bookEntityId: string;
    bookId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookEntity: NonNullable<Awaited<ReturnType<typeof getBookEntityById>>>;
  }
>(
  {
    name: ({ bookEntity }, retryCount) =>
      `Character Appearance ${bookEntity.name}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId, bookEntityId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');
      const bookEntity = await getBookEntityById(bookEntityId);
      if (!bookEntity) throw new UnrecoverableError('Book entity not found');
      if (bookEntity.bookId !== book.id)
        throw new UnrecoverableError('Book entity does not match book');
      if (bookEntity.type !== 'CHARACTER')
        throw new UnrecoverableError('This endpoint only handles CHARACTER entities');
      return { book, bookEntity };
    }
  },
  async ({ book, bookEntity }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title,
        bookEntityId: bookEntity.id,
        bookEntityName: bookEntity.name
      })
      .info('Starting character appearance extraction');

    // Fetch attributes for the character that relate to Appearance
    const attributes = await getChapterEntityAttributesByBookEntityIdAndCategories(
      bookEntity.id,
      ['PHYSICAL', 'MAGICAL']
    );

    if (!attributes.length) {
      ctx.log.info('Skipping appearance extraction - no attributes found');
      return Response.json({
        bookEntityId: null
      });
    }

    const character: CharacterWithAttributes = {
      id: bookEntity.id,
      friendlyId: bookEntity.friendlyId,
      name: bookEntity.name,
      attributes,
      minorUntilChapterId: bookEntity.minorUntilChapterId
    };

    // Check if appearance arcs already exist
    const existingArcResults = await getBookArcsByBookIdAndTypesAndEntityIds(
      book.id,
      ['APPEARANCE'],
      [character.id]
    );

    if (existingArcResults.length > 0) {
      ctx.log.info('Skipping appearance extraction - character already has arcs');
      return Response.json({
        bookEntityId: null
      });
    }

    const appearances = await extractCharacterAppearance(book.id, character, ctx);

    // Generate friendly ID prefix and save to database
    const friendlyIdPrefix = await generateUniqueArcFriendlyPrefix({
      bookId: book.id,
      arcType: 'APPEARANCE',
      entityIds: [character.id]
    });

    const createdArcs = await createBookArcs(
      appearances.map((appearance) => ({
        id: uuidv7(),
        startChapterId: appearance.startChapterId,
        endChapterId: appearance.endChapterId,
        content: appearance.content,
        title: appearance.title,
        type: 'APPEARANCE' as const,
        bookId: book.id,
        bookEntityIds: [character.id]
      })),
      friendlyIdPrefix
    );

    // Isolate arcs inline
    await isolateArcs(
      {
        arcType: 'APPEARANCE',
        arcs: createdArcs,
        bookId: book.id,
        bookTitle: book.title,
        entities: [{ name: character.name, type: 'CHARACTER' }]
      },
      ctx
    );

    return Response.json({
      bookEntityId: character.id
    });
  }
);

async function extractCharacterAppearance(
  bookId: string,
  character: CharacterWithAttributes,
  ctx: WorkflowContext
) {
  // Combine text from all attributes for mention detection
  const attributesText = character.attributes
    .map((attr) => `${attr.name} ${attr.value} ${attr.evidence}`)
    .join(' ');

  // Get related entities from RELATED_RELATIONSHIP arcs
  const relatedEntitiesResult = await getRelatedEntitiesFromArcs({
    bookId,
    bookEntityIds: [character.id],
    searchTextForMentions: attributesText
  });

  ctx.log.info(
    `Found ${relatedEntitiesResult.entities.length} related entity arcs for appearance extraction`
  );

  const hasArc = await determineCharacterArc(character, ctx);

  const maxChapterIdx = await getMaxChapterIdxByBookId(bookId);

  // Determine minor until chapter index if applicable
  let minorUntilChapterIdx: number | undefined;
  if (character.minorUntilChapterId) {
    const minorUntilChapter = await getChapterById(character.minorUntilChapterId);
    if (minorUntilChapter) {
      minorUntilChapterIdx = minorUntilChapter.idx;
    }
  }

  // Fetch all attributes (not just PHYSICAL/MAGICAL) for applicability analysis
  const allAttributes = await getChapterEntityAttributesByBookEntityId(character.id);

  // Determine which appearance attributes are applicable and how they can be resolved
  const applicability = await determineAppearanceApplicability(
    bookId,
    character,
    allAttributes,
    ctx
  );

  ctx.log.info(
    `Appearance applicability for ${character.name}: ${applicability.attributes
      .map((a) => {
        if (!a.applicable) return `${a.name}: N/A`;
        if (a.value) return `${a.name}: ${a.source || 'unknown'} - ${a.value}`;
        return `${a.name}: missing`;
      })
      .join(', ')}`
  );

  // Filter to only attributes with values (exclude missing and N/A)
  const appearanceHints = applicability.attributes
    .filter(
      (a): a is typeof a & { value: string; source: 'explicit' | 'inferred' } =>
        a.applicable && !!a.value && !!a.source
    )
    .map((a) => ({
      name: a.name,
      value: a.value,
      source: a.source
    }));

  const appearances = hasArc
    ? await extractAppearanceArc(
        {
          character,
          relatedEntityArcs:
            relatedEntitiesResult.entities.length > 0
              ? relatedEntitiesResult.entities
              : undefined,
          contextEntityIds: relatedEntitiesResult.contextEntityIds,
          appearanceHints: appearanceHints.length > 0 ? appearanceHints : undefined,
          bookId,
          maxChapterIdx,
          minorUntilChapterIdx
        },
        ctx
      )
    : [
        await extractAppearance(
          {
            character,
            relatedEntityArcs:
              relatedEntitiesResult.entities.length > 0
                ? relatedEntitiesResult.entities
                : undefined,
            contextEntityIds: relatedEntitiesResult.contextEntityIds,
            appearanceHints: appearanceHints.length > 0 ? appearanceHints : undefined,
            bookId,
            maxChapterIdx,
            minorUntilChapterIdx
          },
          ctx
        )
      ];

  return appearances;
}

const DetermineOutputSchema = v.object({
  has_arc: v.boolean()
});

async function determineCharacterArc(
  character: CharacterWithAttributes,
  ctx: WorkflowContext
) {
  const userText = determineEntityArcPrompt.render({
    attributes: character.attributes,
    name: character.name,
    type: 'CHARACTER'
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const message = await ctx.traceComplete(
    'determineCharacterArc',
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const text = getAssistantText(message);
  const xml = extractWrappedXml(text, 'has_arc');

  if (!xml) {
    ctx.log.warn(`Agent: ${text}`);
    throw new RecoverableError('No has_arc found in response');
  }
  ctx.log.info(`Agent: captured <has_arc> (length: ${xml.length})`);

  const ast = parse(xml);

  const data = {
    has_arc: getText(querySelector(ast, 'has_arc')).trim() === 'true'
  };

  const parsedResult = v.parse(DetermineOutputSchema, data);

  return parsedResult.has_arc;
}

const AppearanceApplicabilitySchema = v.object({
  attributes: v.array(
    v.object({
      name: v.pipe(
        v.string(),
        v.description(
          'Attribute name: eye_color, skin_tone, hair_color, age, height, or build'
        )
      ),
      applicable: v.pipe(
        v.boolean(),
        v.description('Whether this attribute applies to the entity')
      ),
      reason: v.pipe(
        v.optional(v.string()),
        v.description('Reason why the attribute is not applicable')
      ),
      value: v.pipe(v.optional(v.string()), v.description('The attribute value')),
      source: v.pipe(
        v.optional(v.picklist(['explicit', 'inferred'])),
        v.description(
          'How the value was determined: explicit (directly stated) or inferred (via tools)'
        )
      ),
      missing: v.pipe(
        v.optional(v.boolean()),
        v.description('True if applicable but no value could be found or inferred')
      )
    })
  )
});

type AppearanceApplicabilityResult = v.InferOutput<typeof AppearanceApplicabilitySchema>;

async function determineAppearanceApplicability(
  bookId: string,
  character: CharacterWithAttributes,
  allAttributes: Attributes,
  ctx: WorkflowContext
): Promise<AppearanceApplicabilityResult> {
  const primaryEntity = { id: character.id, name: character.name };

  const userText = determineAppearanceApplicabilityPrompt.render({
    entity: {
      friendlyId: character.friendlyId,
      name: character.name,
      type: 'CHARACTER'
    },
    attributes: allAttributes
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [
        createLookupCharacterAttributeTool(bookId, primaryEntity),
        createSearchCharacterAttributesTool(bookId, character.id)
      ]
    },
    getApiKey: () => apiKey
  });

  const watcher = watchAgent(
    'determineAppearanceApplicability',
    agent,
    ctx,
    'attribute_analysis'
  );

  try {
    await agent.prompt(userText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Determine appearance applicability aborted');
    } else {
      throw e;
    }
  }

  if (agent.state.errorMessage) {
    ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
  }

  if (!watcher.xml) {
    throw new RecoverableError('No attribute analysis found in response');
  }

  const ast = parse(watcher.xml);
  const attributeNodes = querySelectorAll(ast, 'attribute');

  const data = {
    attributes: attributeNodes.map((node) => {
      const name = getAttribute(node, 'name') || '';
      const applicable = getText(querySelector(node, 'applicable')).trim() === 'true';

      const attr: Record<string, unknown> = { name, applicable };

      if (!applicable) {
        const reason = getText(querySelector(node, 'reason')).trim();
        if (reason) attr.reason = reason;
      } else {
        // Check for value with source attribute
        const valueNode = querySelector(node, 'value');
        if (valueNode) {
          const value = getText(valueNode).trim();
          const source = getAttribute(valueNode, 'source')?.trim();
          if (value) attr.value = value;
          if (source === 'explicit' || source === 'inferred') attr.source = source;
        }

        // Check for missing
        const missingNode = querySelector(node, 'missing');
        if (missingNode && getText(missingNode).trim() === 'true') {
          attr.missing = true;
        }
      }

      return attr;
    })
  };

  const validatedData = v.safeParse(AppearanceApplicabilitySchema, data);

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse appearance applicability: ${v.summarize(validatedData.issues)}`
    );
  }

  return validatedData.output;
}

interface AppearanceInterface {
  character: CharacterWithAttributes;
  relatedEntityArcs?: {
    friendlyId: string;
    name: string;
    type: string;
    summary: string;
    phrasesUsed?: string;
  }[];
  contextEntityIds: string[];
  appearanceHints?: {
    name: string;
    value: string;
    source: 'explicit' | 'inferred';
  }[];
  bookId: string;
  maxChapterIdx: number;
  minorUntilChapterIdx?: number;
}

const SingleAppearanceOutputSchema = v.object({
  appearance: v.object({
    detail: v.pipe(
      v.string(),
      v.description('Complete standalone visual description in flowing prose')
    ),
    title: v.pipe(
      v.string(),
      v.description(
        "Narratively descriptive phrase capturing the essence of the entity's appearance"
      )
    )
  })
});

async function extractAppearance(
  {
    character,
    relatedEntityArcs,
    contextEntityIds,
    appearanceHints,
    bookId,
    maxChapterIdx,
    minorUntilChapterIdx
  }: AppearanceInterface,
  ctx: WorkflowContext
) {
  const userText = extractCharacterAppearancePrompt.render({
    character,
    attributes: character.attributes,
    relatedEntityArcs,
    appearanceHints,
    minorUntilChapterIdx
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [createLookupRelatedEntityAppearanceTool(bookId, contextEntityIds)]
    },
    getApiKey: () => apiKey
  });

  const watcher = watchAgent('extractAppearance', agent, ctx, 'appearance');

  try {
    await agent.prompt(userText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Extract character appearance aborted');
    } else {
      throw e;
    }
  }

  if (agent.state.errorMessage) {
    ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
  }

  if (!watcher.xml) {
    throw new UnrecoverableError('No appearance found in response');
  }

  const ast = parse(watcher.xml);
  const appearanceNode = querySelector(ast, 'appearance');

  if (!appearanceNode) {
    throw new UnrecoverableError(
      `No appearance element found in response: ${watcher.xml}`
    );
  }

  const data = {
    appearance: {
      detail: getInnerHtml(querySelector(appearanceNode, 'detail')).trim(),
      title: getText(querySelector(appearanceNode, 'title')).trim()
    }
  };

  const validatedData = v.safeParse(SingleAppearanceOutputSchema, data);

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse appearance: ${v.summarize(validatedData.issues)}`
    );
  }

  // Get first and last chapters since this appearance spans the whole book
  const startChapter = await getChapterByBookIdAndChapterIdx(bookId, 1);
  const endChapter = await getChapterByBookIdAndChapterIdx(bookId, maxChapterIdx);

  if (!startChapter || !endChapter) {
    throw new RecoverableError(`Could not find first or last chapter for book ${bookId}`);
  }

  return {
    startChapterId: startChapter.id,
    endChapterId: endChapter.id,
    content: validatedData.output.appearance.detail,
    title: validatedData.output.appearance.title
  };
}

const ArcOutputSchema = v.object({
  appearances: v.pipe(
    v.array(
      v.object({
        chapters: v.pipe(
          v.string(),
          v.description(
            'Chapter range where this appearance phase occurs (e.g., "1-5", "6+")'
          )
        ),
        detail: v.pipe(
          v.string(),
          v.description(
            'Complete standalone visual description for this phase in flowing prose'
          )
        ),
        title: v.pipe(
          v.string(),
          v.description(
            'Narratively descriptive phrase capturing the essence of the appearance in this phase'
          )
        )
      })
    ),
    v.description(
      "Sequential phases of the character's appearance transformation throughout the story"
    )
  )
});

async function extractAppearanceArc(
  {
    character,
    relatedEntityArcs,
    contextEntityIds,
    appearanceHints,
    bookId,
    maxChapterIdx,
    minorUntilChapterIdx
  }: AppearanceInterface,
  ctx: WorkflowContext
) {
  const userText = extractCharacterAppearanceArcPrompt.render({
    character,
    attributes: character.attributes,
    relatedEntityArcs,
    appearanceHints,
    minorUntilChapterIdx
  });

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [createLookupRelatedEntityAppearanceTool(bookId, contextEntityIds)]
    },
    getApiKey: () => apiKey
  });

  const watcher = watchAgent('extractAppearanceArc', agent, ctx, 'appearances');

  try {
    await agent.prompt(userText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Extract character appearance arc aborted');
    } else {
      throw e;
    }
  }

  if (agent.state.errorMessage) {
    ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
  }

  if (!watcher.xml) {
    throw new UnrecoverableError('No appearances found in response');
  }

  const ast = parse(watcher.xml);

  const appearanceNodes = querySelectorAll(ast, 'appearance');
  const data = {
    appearances: appearanceNodes.map((appearance) => ({
      chapters: getText(querySelector(appearance, 'chapters')).trim(),
      detail: getInnerHtml(querySelector(appearance, 'detail')).trim(),
      title: getText(querySelector(appearance, 'title')).trim()
    }))
  };

  const validatedData = v.safeParse(ArcOutputSchema, data);

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse appearances: ${v.summarize(validatedData.issues)}`
    );
  }

  if (validatedData.output.appearances.length === 0) {
    throw new RecoverableError('No appearances found in response');
  }

  const mappedData: {
    startChapterId: string;
    endChapterId: string;
    content: string;
    title: string;
  }[] = [];

  for (const appearance of validatedData.output.appearances) {
    const chapterRange = parseChapterRange(appearance.chapters, maxChapterIdx);

    const startChapter = await getChapterByBookIdAndChapterIdx(
      bookId,
      chapterRange.startChapterIdx
    );
    const endChapter = await getChapterByBookIdAndChapterIdx(
      bookId,
      chapterRange.endChapterIdx
    );

    if (!startChapter || !endChapter) {
      throw new RecoverableError(
        `Could not find chapters for range ${appearance.chapters} (${chapterRange.startChapterIdx}-${chapterRange.endChapterIdx})`
      );
    }

    mappedData.push({
      startChapterId: startChapter.id,
      endChapterId: endChapter.id,
      content: appearance.detail,
      title: appearance.title
    });
  }

  return mappedData;
}
