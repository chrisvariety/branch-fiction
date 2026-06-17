import {
  getAttribute,
  extractWrappedXml,
  getText,
  parse,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import { UnrecoverableError } from '@branch-fiction/extension-sdk/worker/error-types';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { bridgeUpdateBookImport } from '@/lib/bridge';
import { getDb } from '@/lib/db';
import {
  getBookEntitiesByBookIdAndNotTypes,
  getBookEntitiesByBookIdAndSignificanceTiers,
  getBookEntitiesByBookIdAndTypes,
  getBookEntityById
} from '@/lib/db/models/book-entity/get-book-entity';
import { updateBookEntityById } from '@/lib/db/models/book-entity/update-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getDistinctPhraseChapterEntityAppellationsByBookId } from '@/lib/db/models/chapter-entity-appellation/get-chapter-entity-appellation';
import { getNonEmptyChapterParagraphsByBookId } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import summarizeAppellationsPrompt from '@/lib/prompts/import/summarize-appellations';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type Logger,
  type WorkflowContext
} from '@/workflow/handler';

const MAX_ATTEMPTS = 5;

function countNameMatches(text: string, name: string): number {
  const regex = new RegExp(`\\b${RegExp.escape(name)}\\b`, 'gim');
  let count = 0;
  while (regex.exec(text) !== null) count++;
  return count;
}

export const handler = createWorkflowFunction<
  {
    bookImportId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookImport: NonNullable<Awaited<ReturnType<typeof getBookImportById>>>;
  }
>(
  {
    name: ({ book }, retryCount) =>
      `Summarize Appellations ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookImportId }) => {
      const bookImport = await getBookImportById(bookImportId);
      if (!bookImport) throw new UnrecoverableError('Book Import not found');
      if (!bookImport.bookId) throw new UnrecoverableError('Book ID not found');
      const book = await getBookById(bookImport.bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      return { book, bookImport };
    },
    onFailure: async (_, error) => {
      await bridgeUpdateBookImport({
        status: error instanceof UnrecoverableError ? 'failed' : 'pending',
        lastError: error.message,
        incrementErrorCount: true
      });
    }
  },
  async ({ book }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title
      })
      .info('Starting appellation summary');

    const appellations = await getDistinctPhraseChapterEntityAppellationsByBookId(
      book.id
    );

    const characterEntities = await getBookEntitiesByBookIdAndTypes(book.id, [
      'CHARACTER'
    ]);

    const nonCharacterEntities = (
      await getBookEntitiesByBookIdAndSignificanceTiers(book.id, ['PRIMARY', 'SECONDARY'])
    ).filter((entity) => entity.type !== 'CHARACTER');

    const llmProcessedIds = new Set([
      ...characterEntities.map((e) => e.id),
      ...nonCharacterEntities.map((e) => e.id)
    ]);

    const remainingEntities = (
      await getBookEntitiesByBookIdAndNotTypes(book.id, ['CHARACTER'])
    ).filter((entity) => !llmProcessedIds.has(entity.id));

    // Combine all entities to check for naming conflicts
    const allEntities = [
      ...characterEntities,
      ...nonCharacterEntities,
      ...remainingEntities
    ];

    const paragraphs = await getNonEmptyChapterParagraphsByBookId(book.id);
    const bookText = paragraphs.map((p) => p.content).join('\n');

    const candidateNames = new Set<string>();
    for (const e of allEntities) {
      for (const n of [e.name, ...e.names, ...e.aliases]) {
        if (n) candidateNames.add(n);
      }
    }
    const nameCountsInText = new Map<string, number>();
    for (const name of candidateNames) {
      nameCountsInText.set(name, countNameMatches(bookText, name));
    }

    const exampleEntity = characterEntities.find((entity) => {
      const phrases = appellations
        .filter((a) => a.targetBookEntityId === entity.id)
        .sort((a, b) => b.phraseCount - a.phraseCount);
      return phrases.length >= 2;
    });
    const exampleSuffix = (() => {
      if (!exampleEntity) return '';
      const phrases = appellations
        .filter((a) => a.targetBookEntityId === exampleEntity.id)
        .sort((a, b) => b.phraseCount - a.phraseCount);
      return ` Which is used more often, '${phrases[0].phrase}' or '${phrases[1].phrase}'?`;
    })();
    await ctx.narrate(
      `Deciding on canonical names for characters first.${exampleSuffix}`
    );

    // Process CHARACTER entities
    if (characterEntities.length) {
      const results = await summarizeAppellations(
        {
          type: 'CHARACTER',
          appellations,
          entities: characterEntities,
          nameCountsInText
        },
        ctx
      );

      await saveAppellationResults({
        results,
        entities: characterEntities,
        allEntities,
        log: ctx.log
      });
    }

    await ctx.narrate('Now doing the same for places and other named things.');

    // Process non-CHARACTER entities (PRIMARY/SECONDARY significance)
    if (nonCharacterEntities.length) {
      const results = await summarizeAppellations(
        {
          type: 'ALL_OTHER',
          appellations,
          entities: nonCharacterEntities,
          nameCountsInText
        },
        ctx
      );

      await saveAppellationResults({
        results,
        entities: nonCharacterEntities,
        allEntities,
        log: ctx.log
      });
    }

    if (remainingEntities.length) {
      await ctx.narrate('Tidying up the rest of the named things.');

      const results = pickMostFrequentNames({
        entities: remainingEntities,
        appellations,
        nameCountsInText
      });

      await saveAppellationResults({
        results,
        entities: remainingEntities,
        allEntities,
        log: ctx.log
      });
    }

    return Response.json({
      bookId: book.id,
      summarized: true
    });
  }
);

const NamedAppellationSchema = v.array(
  v.object({
    id: v.string(),
    name: v.string()
  })
);

const SummarizeCharacterAppellationsOutputSchema = v.object({
  characters: NamedAppellationSchema
});

const SummarizeEntityAppellationsOutputSchema = v.object({
  entities: NamedAppellationSchema
});

async function saveAppellationResults({
  results,
  entities,
  allEntities,
  log
}: {
  results: Array<{
    id: string;
    names: Array<{ name: string; count: number }>;
    primaryName: string;
  }>;
  entities: Awaited<ReturnType<typeof getBookEntitiesByBookIdAndTypes>>;
  allEntities: Awaited<ReturnType<typeof getBookEntitiesByBookIdAndTypes>>;
  log: Logger;
}) {
  // Create a set of all names from all entities to detect conflicts
  const allNames = new Set(allEntities.flatMap((entity) => entity.names));

  // Process each result
  for (const { id, names: appellationNames, primaryName } of results) {
    // Find the entity by friendlyId
    const entity = entities.find((e) => e.friendlyId === id);
    if (!entity) {
      log.warn(`Entity with friendlyId ${id} not found, skipping save`);
      continue;
    }

    await getDb()
      .transaction()
      .execute(async (trx) => {
        const bookEntity = await getBookEntityById(entity.id, trx);

        if (!bookEntity) {
          log.warn(`Book entity ${entity.id} not found in database, skipping`);
          return;
        }

        // Get all appellation phrases (excluding the primary name) - these become aliases
        const potentialAliases = appellationNames
          .map((n) => n.name)
          .filter((name) => name !== primaryName);

        const otherNames = new Set(allNames);
        for (const name of bookEntity.names) {
          otherNames.delete(name);
        }

        const filteredAliases = Array.from(
          new Set(potentialAliases.concat(bookEntity.aliases))
        )
          .filter(
            (alias) =>
              alias !== primaryName &&
              !bookEntity.names.includes(alias) &&
              !otherNames.has(alias)
          )
          .filter(Boolean);

        await updateBookEntityById(
          entity.id,
          {
            aliases: filteredAliases,
            name: primaryName
          },
          trx
        );

        log.info(
          `Updated entity ${entity.id}: name="${primaryName}", aliases=[${filteredAliases.join(', ')}]`
        );
      });
  }
}

function pickMostFrequentNames({
  entities,
  appellations,
  nameCountsInText
}: {
  entities: Awaited<ReturnType<typeof getBookEntitiesByBookIdAndNotTypes>>;
  appellations: Awaited<
    ReturnType<typeof getDistinctPhraseChapterEntityAppellationsByBookId>
  >;
  nameCountsInText: Map<string, number>;
}) {
  const byEntityId = new Map<string, typeof appellations>();
  for (const appellation of appellations) {
    const existing = byEntityId.get(appellation.targetBookEntityId);
    if (existing) {
      existing.push(appellation);
    } else {
      byEntityId.set(appellation.targetBookEntityId, [appellation]);
    }
  }

  return entities.map((entity) => {
    const grouped = (byEntityId.get(entity.id) ?? [])
      .slice()
      .sort((a, b) => b.phraseCount - a.phraseCount);

    const namesByPhrase = new Map<string, number>(
      grouped.map(({ phrase, phraseCount }) => [phrase, phraseCount])
    );
    const extraNames = [entity.name, ...entity.names, ...entity.aliases].filter(Boolean);
    for (const name of extraNames) {
      if (!namesByPhrase.has(name)) {
        namesByPhrase.set(name, nameCountsInText.get(name) ?? 0);
      }
    }

    const primaryName = grouped.length ? grouped[0].phrase : entity.name || extraNames[0];

    return {
      id: entity.friendlyId,
      names: Array.from(namesByPhrase, ([name, count]) => ({ name, count })),
      primaryName
    };
  });
}

async function summarizeAppellations(
  {
    type,
    appellations,
    entities,
    nameCountsInText
  }: {
    appellations: Awaited<
      ReturnType<typeof getDistinctPhraseChapterEntityAppellationsByBookId>
    >;
    entities: Awaited<ReturnType<typeof getBookEntitiesByBookIdAndTypes>>;
    type: 'CHARACTER' | 'ALL_OTHER';
    nameCountsInText: Map<string, number>;
  },
  ctx: WorkflowContext
) {
  const schema =
    type === 'CHARACTER'
      ? SummarizeCharacterAppellationsOutputSchema
      : SummarizeEntityAppellationsOutputSchema;

  const groupedByTargetBookEntityId = appellations.reduce<
    Record<string, typeof appellations>
  >((acc, { targetBookEntityId, ...restAppellation }) => {
    if (!acc[targetBookEntityId]) {
      acc[targetBookEntityId] = [];
    }

    acc[targetBookEntityId].push({ targetBookEntityId, ...restAppellation });
    return acc;
  }, {});

  // Sort each group by phraseCount descending
  for (const entityId in groupedByTargetBookEntityId) {
    groupedByTargetBookEntityId[entityId].sort((a, b) => b.phraseCount - a.phraseCount);
  }

  const entitiesData = entities.map((entity) => {
    const groupedAppellations = groupedByTargetBookEntityId[entity.id] ?? [];
    const namesByPhrase = new Map<string, number>(
      groupedAppellations.map(({ phrase, phraseCount }) => [phrase, phraseCount])
    );
    const extraNames = [entity.name, ...entity.names, ...entity.aliases].filter(Boolean);
    for (const name of extraNames) {
      if (!namesByPhrase.has(name)) {
        namesByPhrase.set(name, nameCountsInText.get(name) ?? 0);
      }
    }
    return {
      id: entity.friendlyId,
      names: Array.from(namesByPhrase, ([name, count]) => ({ name, count }))
    };
  });

  const singleNameResults = entitiesData
    .filter((entity) => entity.names.length === 1)
    .map((entity) => ({
      ...entity,
      primaryName: entity.names[0].name
    }));

  const entitiesDataForLLM = entitiesData.filter((entity) => entity.names.length > 1);

  if (entitiesDataForLLM.length === 0) {
    ctx.log.info(`No ${type} entities with multiple names found, skipping LLM call`);
    return singleNameResults;
  }

  let attempt = 0;
  let successfulResult: Array<{
    id: string;
    names: Array<{ name: string; count: number }>;
    primaryName: string;
  }> | null = null;

  // Map type to prompt type: CHARACTER -> 'character', ALL_OTHER -> 'entity'
  const promptType = type === 'CHARACTER' ? 'character' : 'entity';

  // Retry loop
  while (attempt < MAX_ATTEMPTS && !successfulResult) {
    attempt++;
    ctx.log.info(
      `\n=== Appellation Summary Attempt ${attempt} for ${type} (${entitiesDataForLLM.length}/${entitiesData.length} entities) ===`
    );

    const userText = summarizeAppellationsPrompt.render({
      type: promptType,
      entities: entitiesDataForLLM
    });

    const wrapperTag = `<${promptType}s>`;

    const { model, apiKey, reasoning } = ctx.getPiModel('piText');
    const message = await ctx.traceComplete(
      'summarizeAppellations',
      model,
      { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
      { apiKey, reasoning, sessionId: uuidv7() }
    );
    ctx.trackUsage(message);
    const text = getAssistantText(message);
    const xml = extractWrappedXml(text, `${promptType}s`);

    if (!xml) {
      ctx.log.warn(`No ${wrapperTag} found in response, retrying...`);
      continue;
    }
    ctx.log.info(`Agent: captured ${wrapperTag} (length: ${xml.length})`);

    const ast = parse(xml);
    const itemNodes = querySelectorAll(ast, promptType);

    const items = itemNodes.map((node) => ({
      id: getAttribute(node, 'id') || '',
      name: getText(node).trim()
    }));

    const data = type === 'CHARACTER' ? { characters: items } : { entities: items };

    const parsedResult = v.safeParse(schema, data);

    if (parsedResult.success) {
      const results = Object.values(parsedResult.output)[0];

      // Create a map of results by ID for quick lookup
      const resultsMap = new Map(results.map((r) => [r.id, r.name]));

      let hasErrors = false;

      // Iterate through entityData and validate each one
      for (const entityData of entitiesDataForLLM) {
        const primaryName = resultsMap.get(entityData.id);

        if (!primaryName) {
          ctx.log.warn(
            `No primary name found for entity ID ${entityData.id}. Retrying...`
          );
          hasErrors = true;
          break;
        }

        const availableNames = entityData.names.map((n) => n.name);
        if (!availableNames.includes(primaryName)) {
          ctx.log.warn(
            `Invalid name "${primaryName}" selected for entity ID ${entityData.id}. Available names: [${availableNames.join(', ')}]. Retrying...`
          );
          hasErrors = true;
          break;
        }
      }

      if (hasErrors) {
        continue;
      }

      // All validations passed - combine entitiesDataForLLM with primary names
      successfulResult = entitiesDataForLLM.map((entityData) => ({
        ...entityData,
        primaryName: resultsMap.get(entityData.id)!
      }));

      // Log the results
      const entityMap = new Map(entities.map((entity) => [entity.friendlyId, entity]));
      successfulResult.forEach(({ id, primaryName }) => {
        const entity = entityMap.get(id)!;
        ctx.log.info(
          `Entity: ${entity.names.join(', ')} -> Primary name chosen: ${primaryName}`
        );
      });
    } else {
      ctx.log.warn('Validation errors:', v.summarize(parsedResult.issues), 'Retrying...');
    }
  }

  if (!successfulResult) {
    throw new Error(`Failed to summarize ${type} appellations after ${attempt} attempts`);
  }

  return [...singleNameResults, ...successfulResult];
}
