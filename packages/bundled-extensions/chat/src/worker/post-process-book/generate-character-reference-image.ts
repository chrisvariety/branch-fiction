import { Agent } from '@earendil-works/pi-agent-core';
import { encode } from '@stablelib/base64';
import { v7 as uuidv7 } from 'uuid';

import { RecoverableError, UnrecoverableError } from '@/lib/error-types';
import {
  createLookupRelatedEntityAppearanceTool,
  getRelatedEntitiesFromArcs
} from '@/lib/lit/related-entities';
import { watchAgent } from '@/lib/llm/agent';
import { getText, parse, querySelector } from '@/lib/llm/xml';
import { resolveArtStyle } from '@/lib/media/art-style';
import { debugImage } from '@/lib/media/debug';
import { generateOneShotImage } from '@/lib/media/generate-one-shot-image';
import { assemblePrompt, type StructuredPrompt } from '@/lib/media/image-models';
import { buildAssetUrl, parseAssetUrl } from '@/lib/media/transform-url';
import characterReference from '@/lib/prompts/interactive/character-reference';
import { getBookArcsByBookIdAndTypesAndEntityIds } from '@/worker/db/models/book-arc/get-book-arc';
import { getBookEntityById } from '@/worker/db/models/book-entity/get-book-entity';
import { getBookSettings } from '@/worker/db/models/book-settings/get-book-settings';
import { getBookById } from '@/worker/db/models/book/get-book';
import { upsertCharacterRef } from '@/worker/db/models/character-ref/create-character-ref';
import { addOrdinalSuffix, createWorkflowFunction } from '@/worker/handler';
import { getProvider } from '@/worker/providers';

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
      `Generate Reference Image ${bookEntity.name}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId, bookEntityId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      const bookEntity = await getBookEntityById(bookEntityId);
      if (!bookEntity) throw new UnrecoverableError('Book entity not found');
      if (bookEntity.bookId !== book.id)
        throw new UnrecoverableError('Book entity does not match book');
      if (bookEntity.type !== 'CHARACTER')
        throw new UnrecoverableError('Book entity is not a character');

      return { book, bookEntity };
    }
  },
  async ({ book, bookEntity }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookEntityId: bookEntity.id,
        bookEntityName: bookEntity.name
      })
      .info('Starting character reference image generation');

    const keyPrefix = 'book-entity-reference/';

    // Fetch appearance arcs for the character (non-isolated, so AI can see progression)
    const MIN_ARC_PERCENTAGE = 5;
    const appearanceArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
      book.id,
      ['APPEARANCE'],
      [bookEntity.id],
      { includeChapters: true }
    );

    const arcsWithSpan = getArcsWithPercentageChapterSpan(appearanceArcs);
    const significantArcs = arcsWithSpan.filter(
      (arc) => arc.percentageChapterSpan >= MIN_ARC_PERCENTAGE
    );

    if (arcsWithSpan.length === 0) {
      throw new UnrecoverableError(
        `No appearance arcs found for character ${bookEntity.name}. Ensure character_arc has been materialized first.`
      );
    }

    // Fall back to all arcs if filtering removes everything
    const arcs = (significantArcs.length > 0 ? significantArcs : arcsWithSpan).map(
      (arc) => ({ id: arc.id, friendlyId: arc.friendlyId, content: arc.content })
    );

    const baseDescription = arcs[0]?.content || bookEntity.description || '';

    // Fetch related entities from RELATED_RELATIONSHIP arcs
    const relatedEntitiesResult = await getRelatedEntitiesFromArcs({
      bookId: book.id,
      bookEntityIds: [bookEntity.id],
      searchTextForMentions: baseDescription
    });

    const filteredRelatedEntities = relatedEntitiesResult.entities.filter(
      (entity) => entity.type !== 'CHARACTER' && entity.type !== 'PLACE'
    );

    // Generate enhanced description via agent
    const hasRelatedEntities = filteredRelatedEntities.length > 0;
    const { model, apiKey, reasoning } = ctx.getPiModel('text');
    const agent = new Agent({
      sessionId: uuidv7(),
      initialState: {
        model,
        thinkingLevel: reasoning,
        tools: hasRelatedEntities
          ? [
              createLookupRelatedEntityAppearanceTool(
                book.id,
                relatedEntitiesResult.contextEntityIds,
                'appearance',
                `visual appearance as visible on the head, shoulders, and neck while clothed, in a few concise sentences. Ignore or explicitly note as not visible any traits below the shoulders/neck (e.g., arm tattoos, belt accessories, leg armor). Prioritize describing how this entity appears on this specific character: ${bookEntity.name}. If the data includes appearance details for them, focus on those. Otherwise, write a generalized description of the entity's common form, noting any variation in how it manifests across characters.`,
                ctx
              )
            ]
          : []
      },
      getApiKey: () => apiKey
    });

    const watcher = watchAgent(agent, ctx, 'character');

    const promptText = characterReference.render({
      character: {
        name: bookEntity.name,
        label: bookEntity.label ?? undefined,
        arcs
      },
      relatedEntities: hasRelatedEntities ? filteredRelatedEntities : undefined
    });

    try {
      await agent.prompt(promptText);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        ctx.log.warn('Character reference generation aborted');
      } else {
        throw e;
      }
    }

    if (agent.state.errorMessage) {
      ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
    }

    const characterXml = watcher.xml;
    if (!characterXml) {
      throw new RecoverableError(
        `Failed to generate enhanced description for character ${bookEntity.name}`
      );
    }

    const ast = parse(characterXml);
    const characterEl = querySelector(ast, 'character');
    const descriptionEl = characterEl ? querySelector(characterEl, 'description') : null;
    const enhancedDescription = descriptionEl ? getText(descriptionEl).trim() : '';

    if (!enhancedDescription) {
      throw new RecoverableError(
        `Empty enhanced description for character ${bookEntity.name}`
      );
    }

    const arcIdEl = characterEl ? querySelector(characterEl, 'arc_id') : null;
    const rawArcId = arcIdEl ? getText(arcIdEl).trim() || null : null;
    const selectedArc = rawArcId ? arcs.find((a) => a.friendlyId === rawArcId) : null;

    if (rawArcId && !selectedArc) {
      throw new RecoverableError(
        `LLM returned arc_id "${rawArcId}" that does not match any known arc (valid: ${arcs.map((a) => a.friendlyId).join(', ')})`
      );
    }

    const fallbackArc = selectedArc ?? arcs[0];
    if (!fallbackArc) {
      throw new RecoverableError('No arc available for character reference');
    }

    ctx.log
      .withMetadata({
        characterName: bookEntity.name,
        description: enhancedDescription.substring(0, 100) + '...',
        selectedArcFriendlyId: fallbackArc.friendlyId
      })
      .info('Generating character reference image');

    const settings = await getBookSettings(book.id);

    const prompt: StructuredPrompt = {
      prefix: '',
      content: [
        `Create a headshot portrait of ${bookEntity.name}.`,
        enhancedDescription
      ].join('\n'),
      suffix: [
        'Requirements:',
        '- Head and shoulders only on a completely plain pure white background',
        '- No objects, scenery, props, or environmental elements - only the character',
        `- Rendered in a ${resolveArtStyle(settings?.artStyle ?? null)}`,
        '- Do not include any text, labels, or names'
      ].join('\n')
    };

    const imageResult = await generateOneShotImage(
      getProvider('image_generation_reference'),
      {
        prompt: assemblePrompt(prompt),
        aspectRatio: '1:1'
      }
    );

    await debugImage(encode(imageResult.data), `Reference: ${bookEntity.name}`);

    const characterImage = imageResult.data;

    const key = `${keyPrefix}${bookEntity.id}`;
    const imageUrl = buildAssetUrl(key, imageResult.mimeType);
    const { relPath } = parseAssetUrl(imageUrl);

    ctx.log
      .withMetadata({ characterId: bookEntity.id, characterName: bookEntity.name })
      .info('Saving character reference image');

    await ctx.fs.write(relPath, characterImage);
    await upsertCharacterRef({
      characterId: bookEntity.id,
      bookId: book.id,
      selectedArcFriendlyId: fallbackArc.friendlyId,
      selectedArcId: fallbackArc.id,
      imageUrl
    });

    ctx.log
      .withMetadata({ characterId: bookEntity.id, imageUrl })
      .info('Successfully saved character reference image');

    return Response.json({
      bookEntityId: bookEntity.id,
      imageUrl
    });
  }
);

/**
 * Returns arcs with their percentage chapter span calculated.
 * The percentage is relative to the total chapters covered (max end chapter + 1).
 */
function getArcsWithPercentageChapterSpan<
  T extends { startChapterIdx?: number | null; endChapterIdx?: number | null }
>(arcs: T[]): Array<T & { percentageChapterSpan: number }> {
  if (arcs.length === 0) return [];

  const maxEndChapter = Math.max(...arcs.map((a) => a.endChapterIdx ?? 0));
  const totalChapters = maxEndChapter + 1;

  return arcs.map((arc) => {
    const startIdx = arc.startChapterIdx ?? 0;
    const endIdx = arc.endChapterIdx ?? 0;
    const chapterSpan = Math.abs(endIdx - startIdx) + 1;
    const percentageChapterSpan =
      totalChapters > 0 ? (chapterSpan / totalChapters) * 100 : 0;
    return { ...arc, percentageChapterSpan };
  });
}
