import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type TSchema } from '@earendil-works/pi-ai';
import { encode } from '@toon-format/toon';
import { v7 as uuidv7 } from 'uuid';

import {
  BookEntityExtractionCheckpointEntity,
  BookEntityUpdate,
  NewBookEntity
} from '@/app/lib/db/types';
import { bridgeUpdateBookImport } from '@/lib/bridge';
import { getDb } from '@/lib/db';
import { getBookCategoriesByBookId } from '@/lib/db/models/book-category/get-book-category';
import { upsertBookEntityExtractionCheckpoint } from '@/lib/db/models/book-entity-extraction-checkpoint/create-book-entity-extraction-checkpoint';
import { deleteBookEntityExtractionCheckpointByBookId } from '@/lib/db/models/book-entity-extraction-checkpoint/delete-book-entity-extraction-checkpoint';
import { getBookEntityExtractionCheckpointByBookId } from '@/lib/db/models/book-entity-extraction-checkpoint/get-book-entity-extraction-checkpoint';
import { createBookEntities } from '@/lib/db/models/book-entity/create-book-entity';
import {
  getBookEntitiesByBookIdAndHasContinuedFromBookId,
  getBookEntityByBookIdAndFriendlyId,
  getBookEntityByBookIdAndHasNames,
  getBookEntityByBookIdAndHasNamesCaseInsensitive
} from '@/lib/db/models/book-entity/get-book-entity';
import { updateBookEntityById } from '@/lib/db/models/book-entity/update-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getNonEmptyChapterParagraphsByBookId } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { getMaxChapterIdxByBookId } from '@/lib/db/models/chapter/get-chapter';
import { UnrecoverableError } from '@/lib/error-types';
import {
  abortOnExcessiveChapterCalls,
  createBookChapterContentAgentTool,
  extractProcessedChapters,
  findMissingChapterRange,
  getChapterRangeContentText,
  minChaptersToRead
} from '@/lib/lit/book-content';
import { gatherMentions } from '@/lib/lit/gather-mentions';
import { partitionStopwords } from '@/lib/lit/stop-words';
import { watchAgent } from '@/lib/llm/agent';
import { estimateTokens } from '@/lib/llm/estimate-tokens';
import extractEntitiesDoubleCheckPrompt from '@/lib/prompts/import/extract-entities-double-check';
import extractEntitiesIdentifiedPrompt from '@/lib/prompts/import/extract-entities-identified';
import extractEntitiesIntroPrompt from '@/lib/prompts/import/extract-entities-intro';
import extractEntitiesUnidentifiedPrompt from '@/lib/prompts/import/extract-entities-unidentified';
import extractEntitiesWorldPrompt from '@/lib/prompts/import/extract-entities-world';
import { reportStepProgress } from '@/lib/step-projection';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type Logger,
  type WorkflowContext
} from '@/workflow/handler';

// Stop after this many consecutive rounds with no new chapters completed.
const MAX_STALLED_ROUNDS = 3;

const TOOL_CALL_NUDGE_PROMPT =
  'It looks like you wrote your tool calls as text instead of actually invoking the tools. Please make the real tool calls now using the add_entity, update_entity, and merge_entities tools — do not describe them in your message.';

// Bump when the on-disk checkpoint shape, prompts, or tool schemas change
const CHECKPOINT_SCHEMA_VERSION = 9;

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
      `Entities ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
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
      .info('Starting entity extraction');

    await ctx.narrate(
      'Now I’m reading the whole book (multiple times) and extracting every person, place, or thing mentioned. Should be easy, right? This might take a while.'
    );

    const maxChapter = await getMaxChapterIdxByBookId(book.id);

    const allCategories = await getBookCategoriesByBookId(book.id);

    if (!allCategories.length) {
      throw new UnrecoverableError(
        'No categories found for book, expected them to be extracted already'
      );
    }

    const existingEntities = await getBookEntitiesByBookIdAndHasContinuedFromBookId(
      book.id
    );

    const { entities } = await extractEntities(
      {
        bookId: book.id,
        maxChapter,
        startingEntities: {
          entities: existingEntities.map((entity) => ({
            label: entity.label || entity.name,
            names: entity.names,
            description: entity.description || undefined,
            pronouns: entity.pronouns || 'unknown',
            has_voice: entity.hasVoice,
            friendlyId: entity.friendlyId || undefined,
            type: entity.type || undefined
          }))
        }
      },
      ctx
    );

    await getDb()
      .transaction()
      .execute(async (trx) => {
        const notExisting: NewBookEntity[] = [];
        const toUpdate: Record<string, BookEntityUpdate> = {};
        for (const entity of entities) {
          // Look up by friendlyId first (stable identifier across books), then fall back to name-based lookup
          const exists =
            (entity.friendlyId
              ? await getBookEntityByBookIdAndFriendlyId(book.id, entity.friendlyId, trx)
              : null) ||
            /* exact name match (to avoid duplicate key failure) + case-insensitive variation (to catch similar normalized names) */
            (await getBookEntityByBookIdAndHasNames(book.id, entity.names, trx)) ||
            (await getBookEntityByBookIdAndHasNamesCaseInsensitive(
              book.id,
              entity.names,
              trx
            ));

          if (exists) {
            ctx.log
              .withMetadata({ entity })
              .info(`Duplicate entity found, merging: ${entity.label}`);

            toUpdate[exists.id] = {
              pronouns: entity.pronouns || exists.pronouns,
              names: entity.names,
              description: entity.description || exists.description,
              hasVoice: entity.has_voice || exists.hasVoice,
              type: entity.type,
              label: entity.label || exists.label,
              friendlyId: exists.friendlyId
            };
          } else {
            notExisting.push({
              id: uuidv7(),
              name: entity.label, // this will get updated to the one that is most used by summarize-appellations (at least for important entities)
              names: entity.names,
              pronouns: entity.pronouns,
              description: entity.description,
              aliases: [], // filled in later by extract-chapter-appellations
              bookId: book.id,
              hasVoice: entity.has_voice ?? false,
              type: entity.type ?? 'UNCATEGORIZED',
              label: entity.label,
              friendlyId: `pending_${uuidv7()}`
            });
          }
        }

        if (notExisting.length > 0) {
          await createBookEntities(notExisting, trx);
        }

        if (Object.keys(toUpdate).length > 0) {
          for (const [id, entity] of Object.entries(toUpdate)) {
            await updateBookEntityById(id, entity, trx);
          }
        }
      });

    await deleteBookEntityExtractionCheckpointByBookId(book.id);

    await ctx.narrate(`Found ${entities.length} entities in total.`);

    return Response.json({
      bookId: book.id,
      entityCount: entities.length
    });
  }
);

type Entity = {
  id: number;
  label: string;
  names: string[];
  description?: string;
  pronouns?: string;
  has_voice?: boolean;
  friendlyId?: string;
  type?: string;
};

const AddEntitySchema = Type.Object({
  label: Type.String({ description: 'A clear, canonical name for the entity' }),
  names: Type.Array(Type.String(), {
    description: 'Exact verbatim phrases from the text used to refer to this entity'
  }),
  description: Type.Optional(
    Type.String({ description: 'Brief description of the entity' })
  ),
  pronouns: Type.Optional(
    Type.String({ description: 'Pronouns used for this entity (for CHARACTERs)' })
  ),
  has_voice: Type.Optional(
    Type.Boolean({
      description:
        "Whether the reader directly experiences this entity's voice or thoughts"
    })
  ),
  force: Type.Optional(
    Type.Boolean({
      description:
        'Set to true to allow overlapping names when the text naturally uses the same phrase for different entities. The new entity MUST include at least one additional distinguishing name beyond the overlapping ones (e.g., if "the Essex" is both a ship and a town, the ship entity might have names ["the Essex", "the whaling vessel Essex"] while the town has ["the Essex", "Essex county"]).'
    })
  )
});

const UpdateEntitySchema = Type.Object({
  entity_id: Type.String({
    description: 'The ID of the entity to update (e.g., "ent_123")'
  }),
  label: Type.Optional(Type.String({ description: 'Update the canonical name' })),
  add_names: Type.Optional(
    Type.Array(Type.String(), {
      description: 'New verbatim phrases to add to the names list'
    })
  ),
  remove_names: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Phrases to remove from the names list (case-insensitive match). Use this to fix names that were wrongly assigned to this entity (e.g., another character's name accidentally ended up in this entity's names)."
    })
  ),
  description: Type.Optional(Type.String({ description: 'Replace description' })),
  pronouns: Type.Optional(Type.String({ description: 'Replace pronouns' })),
  has_voice: Type.Optional(Type.Boolean({ description: 'Replace has_voice value' })),
  force: Type.Optional(
    Type.Boolean({
      description:
        'Set to true to allow overlapping names when the text naturally uses the same phrase for different entities. The entity MUST have at least one additional distinguishing name beyond the overlapping ones (e.g., if "the Essex" is both a ship and a town, the ship entity might have names ["the Essex", "the whaling vessel Essex"] while the town has ["the Essex", "Essex county"]).'
    })
  )
});

const MergeEntitiesSchema = Type.Object({
  primary_entity_id: Type.String({
    description: 'The entity ID to keep (e.g., "ent_456")'
  }),
  secondary_entity_id: Type.String({
    description: 'The entity ID to merge into primary (e.g., "ent_789")'
  }),
  label: Type.Optional(Type.String({ description: 'New label for merged entity' })),
  add_names: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Additional names to add beyond those from both entities'
    })
  ),
  description: Type.Optional(Type.String({ description: 'Replace description' })),
  pronouns: Type.Optional(Type.String({ description: 'Replace pronouns' })),
  has_voice: Type.Optional(Type.Boolean({ description: 'Replace has_voice value' }))
});

function looksLikeProperName(str: string): boolean {
  const stripped = str.replace(/^the\s+/i, '').trim();
  return (
    stripped.length > 0 &&
    stripped[0] === stripped[0].toUpperCase() &&
    stripped[0] !== stripped[0].toLowerCase()
  );
}

type EntityChange = { id: number; summary: string };

function createEntityManagementTools(
  entityMap: Map<number, Entity>,
  nextEntityIdRef: { value: number },
  currentFocusRef: { value: string },
  toolErrors: string[],
  roundChanges: EntityChange[],
  log: Logger
) {
  const add_entity: AgentTool<typeof AddEntitySchema> = {
    name: 'add_entity',
    label: 'Add Entity',
    description: "Add a new entity you've discovered in the text",
    parameters: AddEntitySchema,
    execute: async (_id, args) => {
      const cleanedNames = cleanNames(args.names, log);

      if (cleanedNames.length === 0 && args.names.length > 0) {
        const errorMsg = `ERROR: All names for "${args.label}" are generic stopwords (pronouns, articles, or bare common nouns like "the man"). Provide at least one distinguishing name from the text.`;
        log.warn(errorMsg);
        throw new Error(errorMsg);
      }

      // During the unidentified pass, reject entities that appear to already have proper names
      if (currentFocusRef.value === 'unidentified') {
        const properNames = cleanedNames.filter(looksLikeProperName);
        if (properNames.length > 0 && properNames.length === cleanedNames.length) {
          const errorMsg = `ERROR: All names for "${args.label}" appear to be proper names (${properNames.join(', ')}). This entity belongs in the identified entities pass. Skip this entity.`;
          log.warn(errorMsg);
          throw new Error(errorMsg);
        }
      }

      // Check for duplicates - see if any existing entity has overlapping names
      const normalizedNewNames = new Set(
        cleanedNames.map((name) => name.toLowerCase().trim())
      );

      for (const [existingId, existingEntity] of entityMap.entries()) {
        const normalizedExistingNames = new Set(
          existingEntity.names.map((name) => name.toLowerCase().trim())
        );

        const overlap = [...normalizedNewNames].filter((name) =>
          normalizedExistingNames.has(name)
        );

        if (overlap.length > 0) {
          const isPlural = overlap.length > 1;
          const existingEntityEncoded = encode({
            ...existingEntity,
            id: `ent_${existingId}`
          });

          if (args.force) {
            const nonOverlapping = [...normalizedNewNames].filter(
              (name) => !normalizedExistingNames.has(name)
            );
            if (nonOverlapping.length === 0) {
              const errorMsg = `ERROR: Cannot use force=true when all names overlap with an existing entity. "${args.label}" has no distinguishing names beyond: ${overlap.join(', ')}\n\nExisting entity:\n${existingEntityEncoded}\n\n→ If same entity: use merge_entities to combine them\n→ If different: add at least one additional distinguishing name from the text that uniquely identifies this entity (e.g., if "the Essex" is both a ship and a town, add "the whaling vessel Essex" to the ship) and retry with force=true\n→ If the overlapping ${isPlural ? 'names were' : 'name was'} wrongly assigned to the existing entity: use update_entity on ent_${existingId} with remove_names to strip ${isPlural ? 'them' : 'it'} off, then retry add_entity`;
              log.warn(errorMsg);
              throw new Error(errorMsg);
            }
            log.info(
              `Allowing overlapping ${isPlural ? 'names' : 'name'} (${overlap.join(', ')}) for "${args.label}" (force=true, distinguishing: ${nonOverlapping.join(', ')})`
            );
          } else {
            const errorMsg = `ERROR: Name overlap detected! Cannot add "${args.label}" - overlapping ${isPlural ? 'names' : 'name'}: ${overlap.join(', ')}\n\nExisting entity:\n${existingEntityEncoded}\n\n→ If same entity: use merge_entities to combine them (compare labels, descriptions, etc.)\n→ If the overlapping ${isPlural ? 'names were' : 'name was'} wrongly assigned to the existing entity (the existing entity's other names/description don't match ${isPlural ? 'them' : 'it'}): use update_entity on ent_${existingId} with remove_names to strip ${isPlural ? 'them' : 'it'} off, then retry add_entity\n→ If different but text uses same phrase for different entities: add at least one additional distinguishing name from the text (e.g., if "the Essex" is both a ship and a town, add "the whaling vessel Essex" to the ship) and retry with force=true\n→ Otherwise: retry add_entity without the overlapping ${isPlural ? 'names' : 'name'}`;
            log.warn(errorMsg);
            throw new Error(errorMsg);
          }
        }
      }

      const newEntity: Entity = {
        id: nextEntityIdRef.value++,
        label: args.label,
        names: Array.from(new Set(cleanedNames)),
        description: args.description,
        pronouns: args.pronouns,
        has_voice: args.has_voice
      };

      entityMap.set(newEntity.id, newEntity);
      roundChanges.push({ id: newEntity.id, summary: `added as "${newEntity.label}"` });
      const forceTag = args.force ? ' [force=true]' : '';
      log.info(`✓ Added entity: ${newEntity.label} (ent_${newEntity.id})${forceTag}`);
      return {
        content: [
          {
            type: 'text',
            text: `Successfully added entity: ${newEntity.label} (ent_${newEntity.id})`
          }
        ],
        details: {}
      };
    }
  };

  const update_entity: AgentTool<typeof UpdateEntitySchema> = {
    name: 'update_entity',
    label: 'Update Entity',
    description: 'Update an existing entity with new information',
    parameters: UpdateEntitySchema,
    execute: async (_id, args) => {
      const entityId = parseInt(args.entity_id.replace('ent_', ''));

      const entity = entityMap.get(entityId);
      if (!entity) {
        const errorMsg = `Entity ent_${entityId} not found for update`;
        log.warn(errorMsg);
        throw new Error(errorMsg);
      }

      const before = {
        label: entity.label,
        names: entity.names.slice(),
        description: entity.description,
        pronouns: entity.pronouns,
        has_voice: entity.has_voice
      };

      if (args.label) entity.label = args.label;
      if (args.remove_names && args.remove_names.length > 0) {
        const toRemove = new Set(
          args.remove_names.map((name) => name.toLowerCase().trim())
        );
        const filtered = entity.names.filter(
          (name) => !toRemove.has(name.toLowerCase().trim())
        );
        const remainingAfterAdds =
          filtered.length + (args.add_names ? cleanNames(args.add_names, log).length : 0);
        if (remainingAfterAdds === 0) {
          const errorMsg = `ERROR: Cannot remove ${args.remove_names.join(', ')} from ent_${entityId} - it would leave the entity with no names. If this entity should not exist at all, use merge_entities to fold it into the correct entity instead.`;
          log.warn(errorMsg);
          throw new Error(errorMsg);
        }
        const removed = entity.names.filter((name) =>
          toRemove.has(name.toLowerCase().trim())
        );
        const notFound = [...toRemove].filter(
          (norm) => !entity.names.some((n) => n.toLowerCase().trim() === norm)
        );
        if (notFound.length > 0) {
          log.info(
            `remove_names: ${notFound.length} name${notFound.length === 1 ? '' : 's'} not on ent_${entityId}: ${notFound.map((n) => `"${n}"`).join(', ')}`
          );
        }
        entity.names = filtered;
        if (removed.length > 0) {
          log.info(
            `Removed ${removed.length} name${removed.length === 1 ? '' : 's'} from ent_${entityId}: ${removed.map((n) => `"${n}"`).join(', ')}`
          );
        }
      }
      if (args.add_names) {
        const cleanedNames = cleanNames(args.add_names, log);

        if (cleanedNames.length === 0 && args.add_names.length > 0) {
          const errorMsg = `ERROR: All add_names for ent_${entityId} are generic stopwords (pronouns, articles, or bare common nouns like "the man"). Provide at least one distinguishing name from the text.`;
          log.warn(errorMsg);
          throw new Error(errorMsg);
        }

        const allResultingNames = new Set(
          [...entity.names, ...cleanedNames].map((name) => name.toLowerCase().trim())
        );
        const normalizedNewNames = new Set(
          cleanedNames.map((name) => name.toLowerCase().trim())
        );

        for (const [existingId, existingEntity] of entityMap.entries()) {
          if (existingId === entityId) continue;

          const normalizedExistingNames = new Set(
            existingEntity.names.map((name) => name.toLowerCase().trim())
          );

          const overlap = [...normalizedNewNames].filter((name) =>
            normalizedExistingNames.has(name)
          );

          if (overlap.length > 0) {
            const isPlural = overlap.length > 1;
            const existingEntityEncoded = encode({
              ...existingEntity,
              id: `ent_${existingId}`
            });

            if (args.force) {
              const nonOverlapping = [...allResultingNames].filter(
                (name) => !normalizedExistingNames.has(name)
              );
              if (nonOverlapping.length === 0) {
                const errorMsg = `ERROR: Cannot use force=true when all resulting names overlap with an existing entity. ent_${entityId} would have no distinguishing names beyond: ${overlap.join(', ')}\n\nExisting entity:\n${existingEntityEncoded}\n\n→ If same entity: use merge_entities to combine them\n→ If different: add at least one additional distinguishing name from the text that uniquely identifies this entity (e.g., if "the Essex" is both a ship and a town, add "the whaling vessel Essex" to the ship) and retry with force=true\n→ If the overlapping ${isPlural ? 'names were' : 'name was'} wrongly assigned to the other entity: use update_entity on ent_${existingId} with remove_names to strip ${isPlural ? 'them' : 'it'} off, then retry`;
                log.warn(errorMsg);
                throw new Error(errorMsg);
              }
              log.info(
                `Allowing overlapping ${isPlural ? 'names' : 'name'} (${overlap.join(', ')}) for ent_${entityId} (force=true, distinguishing: ${nonOverlapping.join(', ')})`
              );
            } else {
              const errorMsg = `Name overlap detected! Cannot update ent_${entityId} - overlapping ${isPlural ? 'names' : 'name'}: ${overlap.join(', ')}\n\nExisting entity:\n${existingEntityEncoded}\n\n→ If same entity: use merge_entities to combine them (compare labels, descriptions, etc.)\n→ If the overlapping ${isPlural ? 'names were' : 'name was'} wrongly assigned to the other entity: use update_entity on ent_${existingId} with remove_names to strip ${isPlural ? 'them' : 'it'} off, then retry\n→ If different but text uses same phrase for different entities: add at least one additional distinguishing name from the text (e.g., if "the Essex" is both a ship and a town, add "the whaling vessel Essex" to the ship) and retry with force=true\n→ Otherwise: retry update_entity without the overlapping ${isPlural ? 'names' : 'name'}`;
              log.warn(errorMsg);
              throw new Error(errorMsg);
            }
          }
        }

        entity.names = Array.from(new Set([...entity.names, ...cleanedNames]));
      }
      if (args.description) entity.description = args.description;
      if (args.pronouns) entity.pronouns = args.pronouns;
      if (args.has_voice !== undefined) entity.has_voice = args.has_voice;

      const changes: string[] = [];
      if (entity.label !== before.label) changes.push(`label → "${entity.label}"`);
      const addedNames = entity.names.filter((n) => !before.names.includes(n));
      const removedNames = before.names.filter((n) => !entity.names.includes(n));
      if (addedNames.length > 0) changes.push(`added names ${addedNames.join(', ')}`);
      if (removedNames.length > 0)
        changes.push(`removed names ${removedNames.join(', ')}`);
      if (entity.description !== before.description) changes.push('description');
      if (entity.pronouns !== before.pronouns)
        changes.push(`pronouns → ${entity.pronouns}`);
      if (entity.has_voice !== before.has_voice)
        changes.push(`has_voice → ${entity.has_voice}`);
      if (changes.length > 0) {
        roundChanges.push({
          id: entityId,
          summary: `updated "${entity.label}" (${changes.join('; ')})`
        });
      }

      const forceTag = args.force ? ' [force=true]' : '';
      log.info(`✓ Updated entity: ${entity.label} (ent_${entityId})${forceTag}`);
      return {
        content: [
          {
            type: 'text',
            text: `Successfully updated entity: ${entity.label} (ent_${entityId})`
          }
        ],
        details: {}
      };
    }
  };

  const merge_entities: AgentTool<typeof MergeEntitiesSchema> = {
    name: 'merge_entities',
    label: 'Merge Entities',
    description: 'Merge two entities that turn out to be the same',
    parameters: MergeEntitiesSchema,
    execute: async (_id, args) => {
      const primaryId = parseInt(args.primary_entity_id.replace('ent_', ''));
      const secondaryId = parseInt(args.secondary_entity_id.replace('ent_', ''));

      if (primaryId === secondaryId) {
        const errorMsg = `Cannot merge entity ent_${primaryId} with itself`;
        log.warn(errorMsg);
        throw new Error(errorMsg);
      }

      const primary = entityMap.get(primaryId);
      const secondary = entityMap.get(secondaryId);

      if (!primary) {
        const errorMsg = `Primary entity ent_${primaryId} not found for merge`;
        log.warn(errorMsg);
        throw new Error(errorMsg);
      }
      if (!secondary) {
        const errorMsg = `Secondary entity ent_${secondaryId} not found for merge`;
        log.warn(errorMsg);
        throw new Error(errorMsg);
      }

      const mergedNames = Array.from(new Set([...primary.names, ...secondary.names]));
      if (args.add_names) {
        mergedNames.push(...cleanNames(args.add_names, log));
      }

      primary.names = Array.from(new Set(mergedNames));
      if (args.label) primary.label = args.label;
      if (args.description) primary.description = args.description;
      if (args.pronouns) primary.pronouns = args.pronouns;
      if (args.has_voice !== undefined) primary.has_voice = args.has_voice;

      entityMap.delete(secondaryId);
      roundChanges.push({
        id: primaryId,
        summary: `merged ent_${secondaryId} into "${primary.label}"`
      });
      log.info(`✓ Merged ent_${secondaryId} into ent_${primaryId}: ${primary.label}`);
      return {
        content: [
          {
            type: 'text',
            text: `Successfully merged ent_${secondaryId} into ent_${primaryId}: ${primary.label}`
          }
        ],
        details: {}
      };
    }
  };

  // Capture every error a tool raises so the double-check pass can revisit them
  const recordErrors = <P extends TSchema>(tool: AgentTool<P>): AgentTool<P> => ({
    ...tool,
    execute: async (id, params, signal, onUpdate) => {
      try {
        return await tool.execute(id, params, signal, onUpdate);
      } catch (e) {
        if (e instanceof Error) toolErrors.push(e.message);
        throw e;
      }
    }
  });

  return {
    add_entity: recordErrors(add_entity),
    update_entity: recordErrors(update_entity),
    merge_entities: recordErrors(merge_entities)
  };
}

async function extractEntities(
  {
    bookId,
    maxChapter,
    startingEntities
  }: {
    bookId: string;
    maxChapter: number;
    startingEntities?: {
      entities: Array<{
        label: string;
        names: string[];
        description?: string;
        pronouns?: string;
        has_voice?: boolean;
        friendlyId?: string;
        type?: string;
      }>;
    };
  },
  ctx: WorkflowContext
) {
  const entityMap = new Map<number, Entity>();
  const nextEntityIdRef = { value: 1 };
  const completeChapters = new Set<number>();

  const checkpoint = await getBookEntityExtractionCheckpointByBookId(bookId);
  const usingCheckpoint =
    checkpoint && checkpoint.schemaVersion === CHECKPOINT_SCHEMA_VERSION;

  if (checkpoint && !usingCheckpoint) {
    ctx.log.warn(
      `Discarding incompatible checkpoint (saved v${checkpoint.schemaVersion}, current v${CHECKPOINT_SCHEMA_VERSION})`
    );
    await deleteBookEntityExtractionCheckpointByBookId(bookId);
  }

  if (usingCheckpoint) {
    const maxCompleted =
      checkpoint.completeChapters.length > 0
        ? Math.max(...checkpoint.completeChapters)
        : 0;
    await ctx.narrate(
      maxCompleted > 0
        ? `Resuming where I left off: chapter ${maxCompleted}.`
        : 'Resuming where I left off.'
    );
    for (const entity of checkpoint.entities) {
      entityMap.set(entity.id, { ...entity });
    }
    nextEntityIdRef.value = checkpoint.nextEntityId;
    for (const ch of checkpoint.completeChapters) completeChapters.add(ch);
  } else if (startingEntities?.entities) {
    for (const entity of startingEntities.entities) {
      entityMap.set(nextEntityIdRef.value, {
        id: nextEntityIdRef.value,
        label: entity.label,
        names: entity.names,
        description: entity.description,
        pronouns: entity.pronouns,
        has_voice: entity.has_voice,
        friendlyId: entity.friendlyId,
        type: entity.type
      });
      nextEntityIdRef.value++;
    }
  }

  const persistCheckpoint = async () => {
    await upsertBookEntityExtractionCheckpoint({
      id: uuidv7(),
      bookId,
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      entities: Array.from(entityMap.values()).map(
        (e) => stripUndefined(e) as BookEntityExtractionCheckpointEntity
      ),
      nextEntityId: nextEntityIdRef.value,
      completeChapters: Array.from(completeChapters).sort((a, b) => a - b)
    });
  };

  const allParagraphs = await getNonEmptyChapterParagraphsByBookId(bookId);
  const paragraphText = allParagraphs.map((p) => p.content).join('\n');
  const bookTokens = allParagraphs.reduce((sum, p) => sum + estimateTokens(p.content), 0);

  const bookChapterContentTool = createBookChapterContentAgentTool(bookId, maxChapter);
  const currentFocusRef = { value: '' };
  const toolErrors: string[] = [];
  const roundChanges: EntityChange[] = [];
  const entityTools = createEntityManagementTools(
    entityMap,
    nextEntityIdRef,
    currentFocusRef,
    toolErrors,
    roundChanges,
    ctx.log
  );

  let round = 0;
  let stalledRounds = 0;
  const narratedMilestones = new Set<string>();
  let progressLine: Awaited<ReturnType<typeof ctx.narrate>> | null = null;
  const stepStartMs = Date.now();

  while (stalledRounds < MAX_STALLED_ROUNDS) {
    round++;
    ctx.log.info(`\n=== Entity Extraction Round ${round} ===`);

    const processedChapters = Array.from(completeChapters).sort((a, b) => a - b);
    const missingRange = findMissingChapterRange(processedChapters, maxChapter);

    if (!missingRange) {
      ctx.log.info('All chapters have been processed!');
      break;
    }

    const preloadCount = minChaptersToRead(missingRange);
    const preloadEnd = Math.min(missingRange.start + preloadCount - 1, maxChapter);
    const preloadedChapterIdxs = Array.from(
      { length: preloadEnd - missingRange.start + 1 },
      (_, i) => missingRange.start + i
    );

    const contextInfo = missingRange.contextChapter
      ? ` (with chapter ${missingRange.contextChapter} for context)`
      : '';
    ctx.log.info(
      `Processing chapters ${missingRange.start} to ${preloadEnd}${contextInfo}`
    );

    const sessionToolCalls = await runExtractionSession(
      {
        bookId,
        maxChapter,
        missingRange,
        preloadEnd,
        entityMap,
        entityTools,
        bookChapterContentTool,
        currentFocusRef,
        toolErrors,
        roundChanges,
        onPassComplete: async (extractionFocus) => {
          ctx.log.info(
            `--- Completed ${extractionFocus}. Total entities: ${entityMap.size} ---\n`
          );

          if (extractionFocus === 'identified' && round === 1) {
            const compatibleEntities = Array.from(entityMap.values()).map((e) => ({
              id: String(e.id),
              name: e.label,
              names: [e.label, ...e.names.filter((n) => /^[A-Z]/.test(n))],
              aliases: [] as string[],
              type: e.type ?? 'unknown'
            }));
            const mentions = gatherMentions(paragraphText, compatibleEntities);
            const top = Array.from(mentions).sort(
              (a, b) => b.mentionCount - a.mentionCount
            )[0];
            if (top && top.mentionCount > 1) {
              await ctx.narrate(`${top.name} keeps coming up.`);
            }
          }
        }
      },
      ctx
    );

    if (round === 1 && entityMap.size === 0) {
      throw new UnrecoverableError(
        `Entity extraction failed: no entities found after first round (unidentified, identified, world-building passes) across chapters ${missingRange.start}-${preloadEnd}. Check the log for more details.`
      );
    }

    const previousSize = completeChapters.size;

    for (const ch of preloadedChapterIdxs) completeChapters.add(ch);
    for (const ch of extractProcessedChapters(sessionToolCalls)) {
      completeChapters.add(ch);
    }

    ctx.log.info(`Total chapters complete: ${completeChapters.size}/${maxChapter}`);

    if (completeChapters.size > previousSize) {
      stalledRounds = 0;
      const maxCompleted = Math.max(...Array.from(completeChapters));
      let suffix = '';
      if (
        completeChapters.size >= maxChapter * 0.9 &&
        !narratedMilestones.has('almost-done')
      ) {
        narratedMilestones.add('almost-done');
        suffix = ' Nearly there.';
      } else if (
        completeChapters.size >= maxChapter * 0.5 &&
        !narratedMilestones.has('halfway')
      ) {
        narratedMilestones.add('halfway');
        suffix = ' Halfway there.';
      } else if (
        completeChapters.size >= maxChapter * 0.25 &&
        !narratedMilestones.has('quarter')
      ) {
        narratedMilestones.add('quarter');
        const voiceEntities = Array.from(entityMap.values())
          .filter((e) => e.has_voice)
          .map((e) =>
            e.names.find((n) => /^(?:the\s+)?[A-Z]/.test(n) && n.split(/\s+/).length <= 4)
          )
          .filter((n): n is string => Boolean(n))
          .slice(0, 3);
        suffix =
          voiceEntities.length > 0
            ? ` Met some interesting folks so far: ${voiceEntities.join(', ')}.`
            : '';
      }
      const text = `Through chapter ${maxCompleted}.${suffix}`;
      if (progressLine) {
        await progressLine.update(text);
      } else {
        progressLine = await ctx.narrate(text);
      }

      reportStepProgress(ctx, {
        stepId: 'extract_entities',
        stepStartMs,
        fractionOfStepComplete: completeChapters.size / maxChapter,
        bookTokens
      });
    } else {
      stalledRounds++;
      ctx.log.warn(
        `No new chapters completed (stalled ${stalledRounds}/${MAX_STALLED_ROUNDS})`
      );
    }

    const totalProcessed = Array.from(completeChapters).sort((a, b) => a - b);
    ctx.log.info(`Completed chapters: ${totalProcessed.join(', ')}`);

    await persistCheckpoint();

    if (completeChapters.size >= maxChapter) {
      ctx.log.info('All chapters accounted for in entity extraction!');
      break;
    }
  }

  if (stalledRounds >= MAX_STALLED_ROUNDS) {
    throw new UnrecoverableError(
      `Entity extraction stalled: no progress for ${MAX_STALLED_ROUNDS} consecutive rounds. ` +
        `Completed ${completeChapters.size}/${maxChapter} chapters.`
    );
  }

  // Convert entity map to output format
  return {
    entities: Array.from(entityMap.values()).map((entity) => ({
      label: entity.label,
      names: entity.names,
      description: entity.description,
      pronouns: entity.pronouns,
      has_voice: entity.has_voice,
      friendlyId: entity.friendlyId,
      type: entity.type
    }))
  };
}

async function runExtractionSession(
  {
    bookId,
    maxChapter,
    missingRange,
    preloadEnd,
    entityMap,
    entityTools,
    bookChapterContentTool,
    currentFocusRef,
    toolErrors,
    roundChanges,
    onPassComplete
  }: {
    bookId: string;
    maxChapter: number;
    missingRange: NonNullable<ReturnType<typeof findMissingChapterRange>>;
    preloadEnd: number;
    entityMap: Map<number, Entity>;
    entityTools: ReturnType<typeof createEntityManagementTools>;
    bookChapterContentTool: ReturnType<typeof createBookChapterContentAgentTool>;
    currentFocusRef: { value: string };
    toolErrors: string[];
    roundChanges: EntityChange[];
    onPassComplete: (
      extractionFocus: 'unidentified' | 'identified' | 'world-building' | 'double-check'
    ) => Promise<void>;
  },
  ctx: WorkflowContext
) {
  const preloadStart = missingRange.contextChapter ?? missingRange.start;
  const chapterContent = await getChapterRangeContentText(
    bookId,
    preloadStart,
    preloadEnd
  );

  const existingEntities =
    entityMap.size > 0
      ? encode({
          entities: Array.from(entityMap.values()).map((entity) =>
            stripUndefined({ ...entity, id: `ent_${entity.id}` })
          )
        })
      : undefined;

  const introText = extractEntitiesIntroPrompt.render({
    focalStartChapter: missingRange.start,
    endChapter: preloadEnd,
    maxChapter,
    contextChapter: missingRange.contextChapter,
    chapterContent,
    existingEntities
  });

  const passes: Array<{
    focus: 'unidentified' | 'identified' | 'world-building' | 'double-check';
    getText: () => string;
  }> = [
    {
      focus: 'unidentified',
      getText: () =>
        `${introText}\n\n---\n\n${extractEntitiesUnidentifiedPrompt.render({})}`
    },
    {
      focus: 'identified',
      getText: () => extractEntitiesIdentifiedPrompt.render({})
    },
    {
      focus: 'world-building',
      getText: () => extractEntitiesWorldPrompt.render({})
    },
    {
      // Rendered lazily so it reflects the changes accumulated during the
      // prior three passes. Scoped to this round's changes only.
      focus: 'double-check',
      getText: () => {
        const touchedIds = new Set(roundChanges.map((c) => c.id));
        const changedEntities = Array.from(entityMap.values()).filter((e) =>
          touchedIds.has(e.id)
        );
        return extractEntitiesDoubleCheckPrompt.render({
          focalStartChapter: missingRange.start,
          endChapter: preloadEnd,
          changes: roundChanges.map((c) => `- ent_${c.id} ${c.summary}`).join('\n'),
          entities: encode({
            entities: changedEntities.map((entity) =>
              stripUndefined({ ...entity, id: `ent_${entity.id}` })
            )
          }),
          toolErrors: formatToolErrors(toolErrors)
        });
      }
    }
  ];

  // Only this round's changes and errors are relevant to this round's double-check.
  toolErrors.length = 0;
  roundChanges.length = 0;

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [
        bookChapterContentTool,
        entityTools.add_entity,
        entityTools.update_entity,
        entityTools.merge_entities
      ]
    },
    getApiKey: () => apiKey
  });

  const watcher = watchAgent('runExtractionSession', agent, ctx);
  abortOnExcessiveChapterCalls(agent, ctx.log);

  for (const pass of passes) {
    if (pass.focus === 'double-check' && roundChanges.length === 0) {
      ctx.log.info('No entity changes this round; skipping double-check pass.');
      continue;
    }

    currentFocusRef.value = pass.focus;
    ctx.log.info(`\n--- Processing ${pass.focus} entities ---`);
    const text = pass.getText();

    await promptWithToolCallNudge(agent, watcher, text, ctx);

    if (agent.state.errorMessage) {
      ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
    }

    await onPassComplete(pass.focus);
  }

  return watcher.toolCalls;
}

// Prompt the agent, then if it described its tool calls in text rather than
// actually invoking them, nudge it once to make the real calls. Detected by a
// capital-T "Tool call" in the response (avoids matching "No tool calls needed").
async function promptWithToolCallNudge(
  agent: Agent,
  watcher: ReturnType<typeof watchAgent>,
  prompt: string,
  ctx: WorkflowContext
) {
  const runPrompt = async (text: string) => {
    try {
      await agent.prompt(text);
      return true;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        ctx.log.warn('Aborted');
        return false;
      }
      throw e;
    }
  };

  const toolCallsBefore = watcher.toolCalls.length;
  if (!(await runPrompt(prompt))) return;

  const madeToolCalls = watcher.toolCalls.length > toolCallsBefore;
  const describedInText = watcher.lastAssistantText?.includes('Tool call') ?? false;

  if (!madeToolCalls && describedInText) {
    ctx.log.warn('Model described tool calls in text without invoking them; nudging');
    await runPrompt(TOOL_CALL_NUDGE_PROMPT);
  }
}

// Dedupe and condense raised tool errors to their headline line for the
// double-check prompt. Returns undefined when nothing was flagged.
function formatToolErrors(toolErrors: string[]): string | undefined {
  const headlines = new Set(
    toolErrors.map((msg) => msg.split('\n')[0].trim()).filter(Boolean)
  );
  if (headlines.size === 0) return undefined;
  return Array.from(headlines)
    .map((line) => `- ${line}`)
    .join('\n');
}

function cleanNames(names: string[], log?: Logger): string[] {
  const trimmed = names.map((name) => name.trim().replace(/[,.:;!?]+$/, ''));
  const { kept, dropped } = partitionStopwords(trimmed);
  if (dropped.length > 0 && log) {
    log.info(
      `Dropping ${dropped.length} stopword name${dropped.length === 1 ? '' : 's'}: ${dropped.map((n) => `"${n}"`).join(', ')}`
    );
  }
  return kept;
}

// ensure byte-identical toon output for prompt-cache prefix matching on resume.
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
