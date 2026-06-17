import { UnrecoverableError } from '@branch-fiction/extension-sdk/worker/error-types';
import { v7 as uuidv7 } from 'uuid';

import { createBookCharacterPlaceScores } from '@/lib/db/models/book-character-place-score/create-book-character-place-score';
import { deleteBookCharacterPlaceScoresByBookId } from '@/lib/db/models/book-character-place-score/delete-book-character-place-score';
import { getBookEntityHierarchiesByBookId } from '@/lib/db/models/book-entity-hierarchy/get-book-entity-hierarchy';
import {
  updateBookEntitiesByBookId,
  updateBookEntityById
} from '@/lib/db/models/book-entity/update-book-entity';
import { getBookById } from '@/lib/db/models/book/get-book';
import { updateBookById } from '@/lib/db/models/book/update-book';
import { getChapterEntityAttributesByBookEntityIdsAndCategories } from '@/lib/db/models/chapter-entity-attribute/get-chapter-entity-attribute';
import { getChapterRelationshipsWithChapterAndEntitiesByBookId } from '@/lib/db/models/chapter-relationship/get-chapter-relationship';
import { getTopCharacters } from '@/lib/lit/character-significance';
import {
  analyzeEntitySignificance,
  SignificanceTier
} from '@/lib/lit/entity-significance';
import { processHierarchyData } from '@/lib/lit/hierarchy';
import {
  buildHubTerritoryMap,
  classifyBookType,
  HubScore,
  promoteHubsWithAttributes
} from '@/lib/lit/place-significance';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/workflow/handler';

export const handler = createWorkflowFunction<
  {
    bookId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
  },
  {
    success: boolean;
    entitiesProcessed: number;
    bookType?: string | null;
    characterPlaceScoresCount?: number;
    primaryCharacterIds: string[];
    primaryPlaceIds: string[];
  }
>(
  {
    name: ({ book }, retryCount) =>
      `Calculate Significance ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      return { book };
    },
    check: async (_payload, result) => ({
      passed: result.entitiesProcessed > 0,
      metadata: { entitiesProcessed: result.entitiesProcessed }
    })
  },
  async ({ book }, ctx: WorkflowContext) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title
      })
      .info('Starting calculateSignificance');

    await ctx.narrate(
      'Working out who is central to the story and which places matter most.'
    );

    // Clear out previous data - significance tiers and character-place scores
    await updateBookEntitiesByBookId(book.id, {
      significanceTier: null,
      significanceRank: null
    });
    await deleteBookCharacterPlaceScoresByBookId(book.id);

    ctx.log.info('Calculating and saving significance tiers...');

    const relationships = await getChapterRelationshipsWithChapterAndEntitiesByBookId(
      book.id
    );

    if (relationships.length === 0) {
      ctx.log.info('No relationships found, skipping significance calculation');
      return {
        success: true,
        entitiesProcessed: 0,
        primaryCharacterIds: [],
        primaryPlaceIds: []
      };
    }

    const hierarchyRecords = await getBookEntityHierarchiesByBookId(book.id);
    const hierarchyData = processHierarchyData(hierarchyRecords, relationships);

    ctx.log.info(
      `Hierarchy data: ${hierarchyData.hubEraCount} HUB ERAs, ${hierarchyData.localeEraCount} LOCALE ERAs, ` +
        `preferred level: ${hierarchyData.preferredLevel ?? 'none'}`
    );

    // Calculate total chapters from relationships
    const totalChapters = Math.max(...relationships.map((r) => r.chapter.idx));
    const activeLevel = hierarchyData.preferredLevel ?? 'HUB';

    // Build primary hubs from anchors
    const primaryHubs: HubScore[] = hierarchyData.anchors.slice(0, 8).map((anchor) => ({
      hubId: anchor.anchorId,
      hubName: anchor.anchorName,
      totalVolume: anchor.totalVolume,
      chaptersWon: anchor.chaptersWon,
      winningChapters: anchor.winningChapters,
      isEra: anchor.isEra,
      isPromoted: false,
      promotionReason: null
    }));

    // Run promotion logic if we have fewer than MIN_PRIMARY_HUBS ERAs
    const hubsWithPromotions = await promoteHubsWithAttributes(
      primaryHubs,
      hierarchyRecords,
      relationships
    );

    const hubTerritories = buildHubTerritoryMap(hierarchyRecords, activeLevel);

    // Classify the book type
    const { bookType, reason } = classifyBookType(hubsWithPromotions, totalChapters);
    ctx.log.info(`Book type classification: ${bookType} - ${reason}`);

    // Save bookType to the book record
    await updateBookById(book.id, { characterRankType: bookType });

    // Run the character ranking pipeline
    const characterRankings = getTopCharacters(
      bookType,
      hubsWithPromotions,
      hubTerritories,
      relationships,
      hierarchyRecords
    );

    // Demote PRIMARY characters that have no describable appearance (no PHYSICAL/MAGICAL attributes)
    const primaryCandidateIds = characterRankings
      .filter((r) => r.tier === 'PRIMARY')
      .map((r) => r.characterId);

    if (primaryCandidateIds.length > 0) {
      const appearanceAttributes =
        await getChapterEntityAttributesByBookEntityIdsAndCategories(
          primaryCandidateIds,
          ['PHYSICAL', 'MAGICAL']
        );
      const entityIdsWithAppearance = new Set(
        appearanceAttributes.map((a) => a.bookEntityId)
      );
      for (const ranking of characterRankings) {
        if (
          ranking.tier === 'PRIMARY' &&
          !entityIdsWithAppearance.has(ranking.characterId)
        ) {
          ctx.log.info(
            `Demoting "${ranking.characterName}" from PRIMARY to SECONDARY: no PHYSICAL/MAGICAL attributes`
          );
          ranking.tier = 'SECONDARY';
        }
      }
    }

    // Log character rankings
    const primaryChars = characterRankings.filter((r) => r.tier === 'PRIMARY');
    const secondaryChars = characterRankings.filter((r) => r.tier === 'SECONDARY');
    ctx.log.info(
      `Character rankings: ${primaryChars.length} PRIMARY, ${secondaryChars.length} SECONDARY`
    );

    if (primaryChars.length === 0 && characterRankings.length > 0) {
      throw new UnrecoverableError(
        'Zero primary characters after ranking. Likely causes: protagonist(s) are classified as minor THROUGHOUT and therefore ineligible for PRIMARY, or all PRIMARY candidates were demoted due to missing PHYSICAL/MAGICAL attributes.'
      );
    }

    // Save character significance and character-place scores
    const entitySignificance = new Map<
      string,
      { tier: SignificanceTier; rank: number }
    >();
    const characterPlaceScores: Array<{
      id: string;
      bookId: string;
      characterBookEntityId: string;
      placeBookEntityId: string;
      score: number;
    }> = [];

    for (let i = 0; i < characterRankings.length; i++) {
      const ranking = characterRankings[i];
      entitySignificance.set(ranking.characterId, {
        tier: ranking.tier,
        rank: i + 1
      });

      // Collect character-place scores from hub contributions
      for (const contrib of ranking.hubContributions) {
        if (contrib.hubId && contrib.contribution > 0) {
          characterPlaceScores.push({
            id: uuidv7(),
            bookId: book.id,
            characterBookEntityId: ranking.characterId,
            placeBookEntityId: contrib.hubId,
            score: contrib.contribution
          });
        }
      }
    }

    for (let i = 0; i < hubsWithPromotions.length; i++) {
      const hub = hubsWithPromotions[i];
      const tier: SignificanceTier =
        hub.isEra || hub.isPromoted ? 'PRIMARY' : 'SECONDARY';
      entitySignificance.set(hub.hubId, {
        tier,
        rank: i + 1
      });
    }

    ctx.log.info(
      `Place rankings: ${hubsWithPromotions.filter((h) => h.isEra || h.isPromoted).length} PRIMARY, ` +
        `${hubsWithPromotions.filter((h) => !h.isEra && !h.isPromoted).length} SECONDARY`
    );

    const allRankings = analyzeEntitySignificance(relationships);

    // Only extract rankings for non-CHARACTER/PLACE entity types
    for (const ranking of allRankings) {
      const entityType = ranking.entity.type;
      const rankCategoryType = ranking.rankCategoryType;

      // Skip CHARACTER and PLACE entities - we handle those separately above
      if (entityType === 'CHARACTER' || entityType === 'PLACE') continue;

      // For other entity types, save from their type-specific rankings
      if (rankCategoryType === entityType) {
        entitySignificance.set(ranking.entity.id, {
          tier: ranking.significanceTier,
          rank: ranking.rank
        });
      }
    }

    ctx.log.info(`Saving significance tiers for ${entitySignificance.size} entities`);

    for (const [entityId, { tier, rank }] of entitySignificance) {
      await updateBookEntityById(entityId, {
        significanceTier: tier,
        significanceRank: rank
      });
    }

    // Save character-place scores
    if (characterPlaceScores.length > 0) {
      await createBookCharacterPlaceScores(characterPlaceScores);
      ctx.log.info(`Saved ${characterPlaceScores.length} character-place scores`);
    }

    // Collect PRIMARY entity IDs for Dagster fan-out sensor
    const primaryCharacterIds = primaryChars.map((c) => c.characterId);
    const primaryPlaceIds = hubsWithPromotions
      .filter((h) => h.isEra || h.isPromoted)
      .map((h) => h.hubId);

    return {
      success: true,
      entitiesProcessed: entitySignificance.size,
      bookType,
      characterPlaceScoresCount: characterPlaceScores.length,
      primaryCharacterIds,
      primaryPlaceIds
    };
  }
);
