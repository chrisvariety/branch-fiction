import { UnrecoverableError } from '@branch-fiction/extension-sdk/worker/error-types';

import { bridgeUpdateBookImport } from '@/lib/bridge';
import { getDb } from '@/lib/db';
import { getBookEntitiesByBookId } from '@/lib/db/models/book-entity/get-book-entity';
import { updateBookEntityById } from '@/lib/db/models/book-entity/update-book-entity';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getNonEmptyChapterParagraphsByBookId } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { getChapterScenesByBookId } from '@/lib/db/models/chapter-scene/get-chapter-scene';
import { entityThresholds } from '@/lib/lit/entity-significance-estimate';
import { gatherMentions } from '@/lib/lit/gather-mentions';
import { createWorkflowFunction } from '@/workflow/handler';

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
    name: ({ book }) => `Estimate Significance for ${book.title}`,
    payload: async ({ bookImportId }) => {
      const bookImport = await getBookImportById(bookImportId);
      const book = bookImport?.bookId ? await getBookById(bookImport.bookId) : null;
      if (!book || !bookImport)
        throw new UnrecoverableError('Book or Book Import not found');
      return { book, bookImport };
    },
    onFailure: async (_, error) => {
      console.log('Error occurred during significance estimation:', error);
      await bridgeUpdateBookImport({
        status: error instanceof UnrecoverableError ? 'failed' : 'pending',
        lastError: error.message,
        incrementErrorCount: true
      });
    }
  },
  async ({ book }, ctx) => {
    ctx.log
      .withMetadata({ bookId: book.id, bookTitle: book.title })
      .info('Starting estimate significance');

    const bookEntities = await getBookEntitiesByBookId(book.id);

    const paragraphs = await getNonEmptyChapterParagraphsByBookId(book.id);

    const scenes = await getChapterScenesByBookId(book.id);

    const content = paragraphs.map((paragraph) => paragraph.content).join('\n');

    const povEntityIds = Array.from(
      new Set(scenes.flatMap((scene) => scene.povBookEntityId || []))
    );

    const mentions = gatherMentions(content, bookEntities, povEntityIds);

    // Count scene appearances for location/setting entities
    const sceneAppearances = new Map<string, number>();
    for (const scene of scenes) {
      if (scene.locationBookEntityId) {
        sceneAppearances.set(
          scene.locationBookEntityId,
          (sceneAppearances.get(scene.locationBookEntityId) || 0) + 1
        );
      }
      if (scene.settingBookEntityId) {
        sceneAppearances.set(
          scene.settingBookEntityId,
          (sceneAppearances.get(scene.settingBookEntityId) || 0) + 1
        );
      }
    }

    const sceneWeight =
      scenes.length > 0 ? Math.max(1, Math.floor(paragraphs.length / scenes.length)) : 1;

    const augmentedMentions = Array.from(mentions).map((m) => ({
      ...m,
      mentionCount: m.mentionCount + (sceneAppearances.get(m.id) || 0) * sceneWeight
    }));

    const mentionCounts = augmentedMentions.map((m) => m.mentionCount);
    const { primaryThreshold, secondaryThreshold } = entityThresholds(mentionCounts);

    ctx.log
      .withMetadata({
        bookId: book.id,
        primaryThreshold,
        secondaryThreshold,
        sceneWeight
      })
      .info('Calculated entity significance thresholds');

    // Update entities with significance information
    await getDb()
      .transaction()
      .execute(async (trx) => {
        const mentionsArray = augmentedMentions;

        // Group entities by type
        const entitiesByType = new Map<string, typeof mentionsArray>();
        for (const mention of mentionsArray) {
          const existing = entitiesByType.get(mention.type) || [];
          existing.push(mention);
          entitiesByType.set(mention.type, existing);
        }

        for (const [, typeMentions] of entitiesByType) {
          // Separate POV entities from non-POV entities within this type
          const povMentions = povEntityIds
            .map((id) => typeMentions.find((m) => m.id === id))
            .filter((m): m is NonNullable<typeof m> => m !== undefined);

          const nonPovMentions = typeMentions
            .filter((m) => !povEntityIds.includes(m.id))
            .sort((a, b) => b.mentionCount - a.mentionCount);

          // POV entities rank first, then non-POV entities by mention count
          const sortedMentions = [...povMentions, ...nonPovMentions];

          for (let i = 0; i < sortedMentions.length; i++) {
            const mention = sortedMentions[i];

            let tier: 'PRIMARY' | 'SECONDARY' | null;
            // POV entities are always PRIMARY (e.g., first-person "I" narrators)
            if (povEntityIds.includes(mention.id)) {
              tier = 'PRIMARY';
            } else if (mention.mentionCount >= primaryThreshold) {
              tier = 'PRIMARY';
            } else if (mention.mentionCount >= secondaryThreshold) {
              tier = 'SECONDARY';
            } else {
              tier = null;
            }

            const shouldPromoteToCharacter =
              mention.type === 'MENTIONED_INDIVIDUAL' &&
              (tier === 'PRIMARY' || tier === 'SECONDARY');

            await updateBookEntityById(
              mention.id,
              {
                significanceTier: tier,
                significanceRank: i + 1,
                ...(shouldPromoteToCharacter && { type: 'CHARACTER' })
              },
              trx
            );
          }
        }
      });

    ctx.log
      .withMetadata({
        bookId: book.id,
        totalEntities: augmentedMentions.length
      })
      .info('Updated preliminary entity significance tiers');

    return Response.json({
      bookId: book.id,
      totalEntities: augmentedMentions.length
    });
  }
);
