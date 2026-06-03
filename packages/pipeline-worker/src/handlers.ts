import { handler as importBook } from '@/workflow/import-book';
import { handler as calculateSignificance } from '@/workflow/post-process-book/calculate-significance';
import { handler as determineMinors } from '@/workflow/post-process-book/determine-minors';
import { handler as extractAppellationArc } from '@/workflow/post-process-book/extract-appellation-arc';
import { handler as extractCharacterAppearance } from '@/workflow/post-process-book/extract-character-appearance';
import { handler as extractCharacterArc } from '@/workflow/post-process-book/extract-character-arc';
import { handler as extractEntityAppearance } from '@/workflow/post-process-book/extract-entity-appearance';
import { handler as extractEntityAppearancesBatch } from '@/workflow/post-process-book/extract-entity-appearances-batch';
import { handler as extractHierarchy } from '@/workflow/post-process-book/extract-hierarchy';
import { handler as extractPlaceArc } from '@/workflow/post-process-book/extract-place-arc';
import { handler as extractRelatedRelationshipArc } from '@/workflow/post-process-book/extract-related-relationship-arc';
import { handler as extractRelationshipArc } from '@/workflow/post-process-book/extract-relationship-arc';
import { handler as generateCharacterIdentityTag } from '@/workflow/post-process-book/generate-character-identity-tag';
import { handler as generatePlaceIdentityTag } from '@/workflow/post-process-book/generate-place-identity-tag';
import { handler as categorizeEntities } from '@/workflow/process-book-import/categorize-entities';
import { handler as estimateSignificance } from '@/workflow/process-book-import/estimate-significance';
import { handler as extractBroadCategories } from '@/workflow/process-book-import/extract-broad-categories';
import { handler as extractChapterCharacterAppellations } from '@/workflow/process-book-import/extract-chapter-character-appellations';
import { handler as extractChapterEntityAppellations } from '@/workflow/process-book-import/extract-chapter-entity-appellations';
import { handler as extractChapterEntityAttributes } from '@/workflow/process-book-import/extract-chapter-entity-attributes';
import { handler as extractChapterRelationships } from '@/workflow/process-book-import/extract-chapter-relationships';
import { handler as extractEntities } from '@/workflow/process-book-import/extract-entities';
import { handler as extractScenes } from '@/workflow/process-book-import/extract-scenes';
import { handler as extractStyles } from '@/workflow/process-book-import/extract-styles';
import { handler as finalizeScenes } from '@/workflow/process-book-import/finalize-scenes';
import { handler as removeAmbiguousEntityNames } from '@/workflow/process-book-import/remove-ambiguous-entity-names';
import { handler as summarizeAppellations } from '@/workflow/process-book-import/summarize-appellations';

type HandlerArgs = { executionId: string; payload: Record<string, unknown> };
type HandlerFn = (args: HandlerArgs) => Promise<unknown>;

export const handlers: Record<string, HandlerFn> = {
  // Import pipeline
  imported_book: importBook as HandlerFn,
  preliminary_scenes_preview: async (args) =>
    (extractScenes as HandlerFn)({
      executionId: args.executionId,
      payload: { ...args.payload, roundCap: 1 }
    }),
  preliminary_scenes: extractScenes as HandlerFn,
  extract_broad_categories: extractBroadCategories as HandlerFn,
  extract_entities: extractEntities as HandlerFn,
  categorize_entities: categorizeEntities as HandlerFn,
  remove_ambiguous_entity_names: removeAmbiguousEntityNames as HandlerFn,
  finalize_scenes: finalizeScenes as HandlerFn,
  extract_styles: extractStyles as HandlerFn,
  estimate_significance: estimateSignificance as HandlerFn,
  extract_appellations: async (args) => {
    await (extractChapterCharacterAppellations as HandlerFn)(args);
    await (extractChapterEntityAppellations as HandlerFn)(args);
  },
  summarize_appellations: summarizeAppellations as HandlerFn,
  extract_relationships: extractChapterRelationships as HandlerFn,
  extract_entity_attributes: async (args) => {
    for (const type of ['CHARACTER', 'PLACE', 'ALL_OTHER']) {
      await (extractChapterEntityAttributes as HandlerFn)({
        executionId: args.executionId,
        payload: { ...args.payload, type }
      });
    }
  },

  // Post-process pipeline
  extract_hierarchy: extractHierarchy as HandlerFn,
  determine_minors: determineMinors as HandlerFn,
  calculate_significance: calculateSignificance as HandlerFn,
  extract_related_relationship_arc: extractRelatedRelationshipArc as HandlerFn,
  extract_relationship_arc: extractRelationshipArc as HandlerFn,
  extract_appellation_arc: extractAppellationArc as HandlerFn,
  extract_entity_appearances_batch: extractEntityAppearancesBatch as HandlerFn,
  character_arc: async (args) => {
    await (extractCharacterArc as HandlerFn)(args);
    await (extractCharacterAppearance as HandlerFn)(args);
  },
  place_arc: async (args) => {
    await (extractPlaceArc as HandlerFn)(args);
    await (extractEntityAppearance as HandlerFn)(args);
  },
  character_identity_tags: generateCharacterIdentityTag as HandlerFn,
  place_identity_tags: generatePlaceIdentityTag as HandlerFn
};
