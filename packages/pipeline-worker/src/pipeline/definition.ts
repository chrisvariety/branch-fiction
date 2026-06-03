import type { Step } from './types';

const importedBook: Step = {
  id: 'imported_book',
  kind: 'simple',
  label: 'Parsing book',
  depends: [],
  payload: (ctx) => ({ bookImportId: ctx.bookImportId })
};

const preliminaryScenesPreview: Step = {
  id: 'preliminary_scenes_preview',
  kind: 'simple',
  label: 'Sampling scenes',
  depends: ['imported_book'],
  payload: (ctx) => ({ bookImportId: ctx.bookImportId })
};

export const PROJECTION_STEPS: Step[] = [importedBook, preliminaryScenesPreview];

export const EXTRACT_STEPS: Step[] = [
  importedBook,
  {
    id: 'preliminary_scenes',
    kind: 'simple',
    label: 'Extracting scenes',
    depends: ['imported_book', 'preliminary_scenes_preview'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId })
  },
  {
    id: 'extract_broad_categories',
    kind: 'simple',
    label: 'Extracting categories',
    depends: ['preliminary_scenes'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId })
  },
  {
    id: 'extract_entities',
    kind: 'simple',
    label: 'Extracting entities',
    depends: ['extract_broad_categories'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId })
  },
  {
    id: 'categorize_entities',
    kind: 'simple',
    label: 'Categorizing entities',
    depends: ['extract_entities'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId })
  },
  {
    id: 'remove_ambiguous_entity_names',
    kind: 'simple',
    label: 'Deduplicating entities',
    depends: ['categorize_entities'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId })
  },
  {
    id: 'finalize_scenes',
    kind: 'simple',
    label: 'Finalizing scenes',
    depends: ['preliminary_scenes', 'remove_ambiguous_entity_names'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId, isPreliminary: false })
  },
  {
    id: 'extract_styles',
    kind: 'simple',
    label: 'Analyzing writing style',
    depends: ['finalize_scenes'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId })
  },
  {
    id: 'estimate_significance',
    kind: 'simple',
    label: 'Estimating significance',
    depends: ['finalize_scenes'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId })
  },
  {
    id: 'extract_appellations',
    kind: 'fan-out',
    label: 'Extracting appellations',
    depends: ['estimate_significance'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId }),
    enumerator: 'scene-groups',
    progressNarrative: 'Simultaneously, reading each chapter to see who calls who what.'
  },
  {
    id: 'summarize_appellations',
    kind: 'simple',
    label: 'Summarizing appellations',
    depends: ['extract_appellations'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId })
  },
  {
    id: 'extract_relationships',
    kind: 'fan-out',
    label: 'Extracting relationships',
    depends: ['summarize_appellations'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId }),
    enumerator: 'scene-groups',
    progressNarrative: 'Mapping out all the relationships. Who likes who?'
  },
  {
    id: 'extract_entity_attributes',
    kind: 'fan-out',
    label: 'Extracting entity attributes',
    depends: ['summarize_appellations'],
    payload: (ctx) => ({ bookImportId: ctx.bookImportId }),
    enumerator: 'scene-groups',
    progressNarrative: 'Learning all the minute details: hair, eyes, etc.'
  },

  {
    id: 'extract_hierarchy',
    kind: 'simple',
    label: 'Extracting hierarchy',
    depends: ['extract_styles', 'extract_relationships', 'extract_entity_attributes'],
    payload: (ctx) => ({ bookId: ctx.bookId })
  },
  {
    id: 'determine_minors',
    kind: 'simple',
    label: 'Determining minors',
    depends: ['extract_styles', 'extract_relationships', 'extract_entity_attributes'],
    payload: (ctx) => ({ bookId: ctx.bookId })
  },
  {
    id: 'calculate_significance',
    kind: 'simple',
    label: 'Calculating significance',
    depends: ['extract_hierarchy', 'determine_minors'],
    payload: (ctx) => ({ bookId: ctx.bookId })
  }
];

export const ARC_STEPS: Step[] = [
  {
    id: 'extract_related_relationship_arc',
    kind: 'simple',
    label: 'Extracting related relationship arcs',
    depends: ['calculate_significance'],
    payload: (ctx) => ({ bookId: ctx.bookId, significanceTiers: ['PRIMARY'] })
  },
  {
    id: 'extract_relationship_arc',
    kind: 'simple',
    label: 'Extracting relationship arcs',
    depends: ['extract_related_relationship_arc'],
    payload: (ctx) => ({ bookId: ctx.bookId, significanceTiers: ['PRIMARY'] })
  },
  {
    id: 'extract_appellation_arc',
    kind: 'simple',
    label: 'Extracting appellation arcs',
    depends: ['calculate_significance'],
    payload: (ctx) => ({ bookId: ctx.bookId })
  },
  {
    id: 'extract_entity_appearances_batch',
    kind: 'simple',
    label: 'Extracting entity appearances',
    depends: ['calculate_significance'],
    payload: (ctx) => ({ bookId: ctx.bookId })
  },
  {
    id: 'character_arc',
    kind: 'fan-out',
    label: 'Extracting character arcs',
    depends: [
      'calculate_significance',
      'determine_minors',
      'extract_related_relationship_arc'
    ],
    payload: (ctx) => ({ bookId: ctx.bookId }),
    enumerator: 'character-entities',
    progressNarrative: 'Tracing every character through their journey.'
  },
  {
    id: 'place_arc',
    kind: 'fan-out',
    label: 'Extracting place arcs',
    depends: [
      'calculate_significance',
      'extract_hierarchy',
      'extract_related_relationship_arc'
    ],
    payload: (ctx) => ({ bookId: ctx.bookId }),
    enumerator: 'place-entities',
    progressNarrative: 'Walking each setting through its changes.'
  },
  {
    id: 'character_identity_tags',
    kind: 'simple',
    label: 'Generating character identity tags',
    depends: ['character_arc', 'extract_relationship_arc'],
    payload: (ctx) => ({ bookId: ctx.bookId })
  },
  {
    id: 'place_identity_tags',
    kind: 'simple',
    label: 'Generating place identity tags',
    depends: ['place_arc'],
    payload: (ctx) => ({ bookId: ctx.bookId })
  }
];

export const STEPS: Step[] = Array.from(
  new Map(
    [...PROJECTION_STEPS, ...EXTRACT_STEPS, ...ARC_STEPS].map((s) => [s.id, s])
  ).values()
);

export const STEP_IDS = STEPS.map((s) => s.id);

const stepMap = new Map(STEPS.map((s) => [s.id, s]));

export function getStep(id: string): Step {
  const step = stepMap.get(id);
  if (!step) throw new Error(`Unknown pipeline step: ${id}`);
  return step;
}

export function getDownstream(stepId: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const queue = [stepId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const step of STEPS) {
      if (step.depends.includes(current) && !visited.has(step.id)) {
        visited.add(step.id);
        result.push(step.id);
        queue.push(step.id);
      }
    }
  }

  return result;
}
