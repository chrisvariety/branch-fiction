import { getText, parse, querySelector } from '@branch-fiction/extension-sdk/llm/xml';
import { watchAgent } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { Agent } from '@earendil-works/pi-agent-core';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { BookEntity } from '@/app/lib/db/types';
import { getDb } from '@/lib/db';
import {
  getBookEntitiesByBookIdAndTypesAndSignificanceTiers,
  getBookEntityById
} from '@/lib/db/models/book-entity/get-book-entity';
import { updateBookEntityById } from '@/lib/db/models/book-entity/update-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getChapterEntityAttributesByBookEntityIdsAndCategories } from '@/lib/db/models/chapter-entity-attribute/get-chapter-entity-attribute';
import { getChaptersByBookId } from '@/lib/db/models/chapter/get-chapter';
import {
  createLookupCharacterAttributeTool,
  createSearchCharacterAttributesTool
} from '@/lib/lit/attributes';
import { estimateTokens } from '@/lib/llm/estimate-tokens';
import determineMinorsPrompt from '@/lib/prompts/post-processing/determine-minors';
import determineMinorsFollowupPrompt from '@/lib/prompts/post-processing/determine-minors-followup';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

// potential improvement: group by species first?
const CONTEXT_LIMIT_TOKENS = 128_000;
const CONTEXT_HEADROOM_TOKENS = 20_000;

type CharacterWithAttributes = {
  id: string;
  friendlyId: string;
  name: string;
  attributes: Array<{
    chapterIdx: number;
    category: string;
    name: string;
    value: string;
    evidence: string;
  }>;
};

type Classification = {
  characterId: string;
  friendlyId: string;
  category: 'ADULT_THROUGHOUT' | 'MINOR_THROUGHOUT' | 'BECAME_ADULT';
  firstAdultChapter: number | null;
};

export const handler = createWorkflowFunction<
  {
    bookId: string;
    focusBookEntityId?: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    focusBookEntity?: Awaited<ReturnType<typeof getBookEntityById>>;
  },
  { bookId: string; charactersUpdated: number }
>(
  {
    name: ({ book, focusBookEntity }, retryCount) =>
      `Determine Minors ${book.title}${focusBookEntity ? `, ${focusBookEntity.name} recheck` : ''}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId, focusBookEntityId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      const focusBookEntity = focusBookEntityId
        ? await getBookEntityById(focusBookEntityId)
        : undefined;

      return { book, focusBookEntity };
    },
    check: async (_payload, result) => ({
      passed: result.charactersUpdated >= 0,
      severity: 'WARN' as const,
      metadata: { charactersUpdated: result.charactersUpdated }
    })
  },
  async ({ book, focusBookEntity }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title,
        focusBookEntityId: focusBookEntity?.id,
        focusBookEntityName: focusBookEntity?.name
      })
      .info('Starting minor character determination');

    if (!focusBookEntity) {
      await ctx.narrate('Also checking character ages and descriptions.');
    }

    const characters = focusBookEntity
      ? [focusBookEntity]
      : await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
          book.id,
          ['CHARACTER'],
          ['PRIMARY', 'SECONDARY']
        );

    if (characters.length === 0) {
      ctx.log.info('No PRIMARY or SECONDARY characters found for minor determination');
      return {
        bookId: book.id,
        charactersUpdated: 0
      };
    }

    ctx.log.info(`Found ${characters.length} characters to analyze`);

    const physicalAttributes =
      await getChapterEntityAttributesByBookEntityIdsAndCategories(
        characters.map((c) => c.id),
        ['PHYSICAL']
      );

    const attributesByCharacter = new Map<
      string,
      CharacterWithAttributes['attributes']
    >();

    for (const attr of physicalAttributes) {
      if (!attributesByCharacter.has(attr.bookEntityId)) {
        attributesByCharacter.set(attr.bookEntityId, []);
      }
      attributesByCharacter.get(attr.bookEntityId)!.push({
        chapterIdx: attr.chapterIdx,
        category: attr.category,
        name: attr.name,
        value: attr.value,
        evidence: attr.evidence
      });
    }

    const charactersWithAttributes: CharacterWithAttributes[] = characters
      .map((character) => ({
        id: character.id,
        friendlyId: character.friendlyId,
        name: character.name,
        attributes: attributesByCharacter.get(character.id) || []
      }))
      .filter((character) => character.attributes.length > 0);

    if (charactersWithAttributes.length === 0) {
      ctx.log.info('No characters with physical attributes to analyze');
      return {
        bookId: book.id,
        charactersUpdated: 0
      };
    }

    ctx.log.info(
      `Analyzing ${charactersWithAttributes.length} characters with physical attributes`
    );

    const chapters = await getChaptersByBookId(book.id);
    const chapterIdxToId = new Map(chapters.map((c) => [c.idx, c.id]));

    const classifications = await determineMinorStatusesBatched(
      book.id,
      charactersWithAttributes,
      ctx,
      Boolean(focusBookEntity)
    );

    let updatedCount = 0;
    await getDb()
      .transaction()
      .execute(async (trx) => {
        for (const classification of classifications) {
          let minorStatus: BookEntity['minorStatus'];
          let minorUntilChapterId: string | null = null;

          if (classification.category === 'ADULT_THROUGHOUT') {
            minorStatus = 'NEVER';
          } else if (classification.category === 'MINOR_THROUGHOUT') {
            minorStatus = 'THROUGHOUT';
          } else {
            const chapterId =
              classification.firstAdultChapter !== null
                ? chapterIdxToId.get(classification.firstAdultChapter)
                : undefined;
            if (chapterId) {
              minorStatus = 'UNTIL_CHAPTER';
              minorUntilChapterId = chapterId;
            } else {
              ctx.log.warn(
                `Chapter not found for idx ${classification.firstAdultChapter} for character ${classification.friendlyId}`
              );
              minorStatus = 'THROUGHOUT';
            }
          }

          await updateBookEntityById(
            classification.characterId,
            {
              minorStatus,
              minorUntilChapterId
            },
            trx
          );

          updatedCount++;
        }
      });

    ctx.log.info(`Updated ${updatedCount} characters with minor status`);

    return {
      bookId: book.id,
      charactersUpdated: updatedCount
    };
  }
);

const MinorStatusOutputSchema = v.object({
  category: v.picklist(['ADULT_THROUGHOUT', 'MINOR_THROUGHOUT', 'BECAME_ADULT']),
  firstAdultChapter: v.nullable(v.number())
});

type Batch = {
  agent: Agent;
  watcher: ReturnType<typeof watchAgent>;
  contextTokens: number;
  count: number;
};

function createBatch(bookId: string, ctx: WorkflowContext): Batch {
  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [
        createLookupCharacterAttributeTool(bookId),
        createSearchCharacterAttributesTool(bookId)
      ]
    },
    getApiKey: () => apiKey
  });
  const watcher = watchAgent('determineMinorStatusesBatched', agent, ctx, 'minor-status');
  const batch: Batch = { agent, watcher, contextTokens: 0, count: 0 };

  agent.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const usage = event.message.usage;
      if (usage) {
        // cacheRead + input is the full prompt sent; output is what came back
        batch.contextTokens = usage.cacheRead + usage.input + usage.output;
      }
    }
  });

  return batch;
}

async function runTurn(
  batch: Batch,
  userText: string,
  friendlyId: string,
  ctx: WorkflowContext
): Promise<string> {
  batch.watcher.xml = null;

  try {
    await batch.agent.prompt(userText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn(`Determine minor status aborted for ${friendlyId}`);
    } else {
      throw e;
    }
  }

  if (batch.agent.state.errorMessage) {
    throw new RecoverableError(
      `Agent ended with error for ${friendlyId}: ${batch.agent.state.errorMessage}`
    );
  }

  if (!batch.watcher.xml) {
    throw new RecoverableError(`No minor-status found in response for ${friendlyId}`);
  }

  return batch.watcher.xml;
}

async function determineMinorStatusesBatched(
  bookId: string,
  characters: CharacterWithAttributes[],
  ctx: WorkflowContext,
  isRecheck: boolean
): Promise<Classification[]> {
  const classifications: Classification[] = [];
  let batch: Batch | null = null;

  for (const character of characters) {
    const initText = determineMinorsPrompt.render({ character, isRecheck });
    const followupText = determineMinorsFollowupPrompt.render({ character });

    if (batch !== null) {
      const projectedNextTokens = batch.contextTokens + estimateTokens(followupText);
      if (projectedNextTokens > CONTEXT_LIMIT_TOKENS - CONTEXT_HEADROOM_TOKENS) {
        ctx.log.info(
          `Rolling over agent after ${batch.count} characters (context=${batch.contextTokens} tokens)`
        );
        batch = null;
      }
    }

    if (batch === null) batch = createBatch(bookId, ctx);

    let xml: string;
    try {
      const userText = batch.count === 0 ? initText : followupText;
      xml = await runTurn(batch, userText, character.friendlyId, ctx);
    } catch (e) {
      if (!(e instanceof RecoverableError)) throw e;
      ctx.log.warn(
        `Rolling over batch after empty response for ${character.friendlyId} and retrying`
      );
      batch = createBatch(bookId, ctx);
      xml = await runTurn(batch, initText, character.friendlyId, ctx);
    }

    const result = parseMinorStatus(xml, character.friendlyId, ctx);

    classifications.push({
      characterId: character.id,
      friendlyId: character.friendlyId,
      category: result.category,
      firstAdultChapter: result.firstAdultChapter
    });

    batch.count++;
  }

  return classifications;
}

function parseMinorStatus(xml: string, friendlyId: string, ctx: WorkflowContext) {
  const ast = parse(xml);
  const category = getText(querySelector(ast, 'category')).trim();
  const firstAdultChapterText = getText(querySelector(ast, 'first-adult-chapter')).trim();

  let firstAdultChapter: number | null = null;
  if (
    firstAdultChapterText !== '' &&
    firstAdultChapterText !== 'n/a' &&
    firstAdultChapterText !== 'never'
  ) {
    const parsed = Number(firstAdultChapterText);
    if (!Number.isNaN(parsed)) firstAdultChapter = parsed;
  }

  const validated = v.safeParse(MinorStatusOutputSchema, { category, firstAdultChapter });

  if (!validated.success) {
    ctx.log.error(`Validation error for ${friendlyId}: ${v.summarize(validated.issues)}`);
    throw new RecoverableError(
      `Failed to parse minor status for ${friendlyId}: ${v.summarize(validated.issues)}`
    );
  }

  return validated.output;
}
