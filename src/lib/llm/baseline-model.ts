export const BASELINE_MODEL_BOOK_TOKENS = 250_659;

// Total pipeline wall (EXTRACT 4883s + ARC 691s), assuming the two phases run contiguously.
export const BASELINE_MODEL_PIPELINE_TOTAL_SEC = 5574;

// Total model cost on the reference run ($15.65 EXTRACT + $3.04 ARC).
export const BASELINE_MODEL_PIPELINE_TOTAL_COST_USD = 18.69;

// Per-step wall span (fan-out steps: max(completed) - min(started)); sub-second steps omitted.
export const BASELINE_MODEL_STEP_WALL_SEC: Record<string, number> = {
  imported_book: 3,
  preliminary_scenes: 152,
  extract_entities: 567,
  categorize_entities: 39,
  remove_ambiguous_entity_names: 1,
  finalize_scenes: 19,
  extract_styles: 47,
  extract_appellations: 1845,
  summarize_appellations: 15,
  extract_relationships: 2153,
  extract_entity_attributes: 282,
  extract_hierarchy: 14,
  determine_minors: 48,
  extract_related_relationship_arc: 480,
  extract_relationship_arc: 205,
  extract_appellation_arc: 133,
  extract_entity_appearances_batch: 43,
  character_arc: 47,
  place_arc: 60,
  character_identity_tags: 6,
  place_identity_tags: 7
};

// Per-step share of total pipeline cost (sums to ~1.0). Total cost on the reference run was $18.69 ($15.65 EXTRACT + $3.04 ARC).
export const BASELINE_MODEL_STEP_COST_SHARE: Record<string, number> = {
  imported_book: 0.0002,
  preliminary_scenes: 0.052,
  extract_entities: 0.1055,
  categorize_entities: 0.0036,
  remove_ambiguous_entity_names: 0.0002,
  finalize_scenes: 0.0015,
  extract_styles: 0.0212,
  extract_appellations: 0.2022,
  summarize_appellations: 0.0017,
  extract_relationships: 0.2915,
  extract_entity_attributes: 0.1435,
  extract_hierarchy: 0.0025,
  determine_minors: 0.0117,
  extract_related_relationship_arc: 0.0702,
  extract_relationship_arc: 0.0151,
  extract_appellation_arc: 0.0217,
  extract_entity_appearances_batch: 0.0022,
  character_arc: 0.0368,
  place_arc: 0.0117,
  character_identity_tags: 0.0044,
  place_identity_tags: 0.0005
};

// Per-step reference metrics; used to classify whether the running model behaves normally.
export const BASELINE_MODEL_BEHAVIOR_REFERENCE: Record<
  string,
  { secPerCall: number; outputPerBookToken: number }
> = {
  preliminary_scenes: {
    secPerCall: 152 / 65,
    outputPerBookToken: 8_467 / 250_659
  },
  extract_entities: {
    secPerCall: 567 / 80,
    outputPerBookToken: 60_681 / 250_659
  },
  extract_related_relationship_arc: {
    secPerCall: 480 / 43,
    outputPerBookToken: 51_750 / 250_659
  },
  extract_relationship_arc: {
    secPerCall: 205 / 24,
    outputPerBookToken: 23_037 / 250_659
  }
};

export const BASELINE_MODEL_PRELIMINARY_SCENES_CALLS = 65;
export const BASELINE_MODEL_PRELIMINARY_SCENES_WALL_SEC =
  BASELINE_MODEL_STEP_WALL_SEC.preliminary_scenes;
export const BASELINE_MODEL_PRELIMINARY_SCENES_COST_SHARE =
  BASELINE_MODEL_STEP_COST_SHARE.preliminary_scenes;
export const BASELINE_MODEL_PRELIMINARY_SCENES_WALL_SHARE =
  BASELINE_MODEL_PRELIMINARY_SCENES_WALL_SEC / BASELINE_MODEL_PIPELINE_TOTAL_SEC;
export const BASELINE_MODEL_PRELIMINARY_SCENES_SEC_PER_CALL =
  BASELINE_MODEL_PRELIMINARY_SCENES_WALL_SEC / BASELINE_MODEL_PRELIMINARY_SCENES_CALLS;

// Generous: model is "normal" if both metrics stay under these multiples.
export const SEC_PER_CALL_MAX_MULTIPLIER = 3;
export const OUTPUT_RATIO_MAX_MULTIPLIER = 2;
export const MIN_CALLS_FOR_CLASSIFICATION = 5;

export type Behavior = 'normal' | 'unknown';

export type EstimateRange<T extends number = number> = {
  min: T;
  max: T;
};

export type EtaRange = { minSeconds: number; maxSeconds: number };
export type CostRange = { minCents: number; maxCents: number };

export type ProjectionSample = {
  wallSec: number;
  calls: number;
  costTotal: number;
};

export type ImportEstimate = {
  etaSeconds: EstimateRange;
  costCents: EstimateRange;
  behavior: Behavior;
};

// Estimate from a projection sample (partial `preliminary_scenes` run), extrapolated to the full pipeline.
export function estimateFromSample({
  sample,
  bookTokens
}: {
  sample: ProjectionSample;
  bookTokens: number;
}): ImportEstimate | null {
  if (sample.calls <= 0 || sample.wallSec <= 0 || bookTokens <= 0) {
    return null;
  }

  const secPerCall = sample.wallSec / sample.calls;
  const costPerCall = sample.costTotal / sample.calls;

  const expectedCalls =
    (bookTokens / BASELINE_MODEL_BOOK_TOKENS) * BASELINE_MODEL_PRELIMINARY_SCENES_CALLS;
  const expectedStepWallSec = expectedCalls * secPerCall;
  const expectedStepCostUsd = expectedCalls * costPerCall;

  const projectedTotalWallSec =
    expectedStepWallSec / BASELINE_MODEL_PRELIMINARY_SCENES_WALL_SHARE;
  const projectedTotalCostUsd =
    expectedStepCostUsd / BASELINE_MODEL_PRELIMINARY_SCENES_COST_SHARE;

  const inSecBand =
    secPerCall <=
    BASELINE_MODEL_PRELIMINARY_SCENES_SEC_PER_CALL * SEC_PER_CALL_MAX_MULTIPLIER;
  const behavior: Behavior = inSecBand ? 'normal' : 'unknown';

  const sampleRatio = Math.min(1, sample.calls / BASELINE_MODEL_PRELIMINARY_SCENES_CALLS);
  const uncertainty = clamp(1 - 2 * sampleRatio, 0.2, 0.5);

  const minWall = Math.max(1, Math.round(projectedTotalWallSec * (1 - uncertainty)));
  const minCost = Math.max(
    0,
    Math.round(projectedTotalCostUsd * (1 - uncertainty) * 100)
  );

  // Always publish an upper bound; the caller distinguishes confidence via `behavior`.
  return {
    etaSeconds: {
      min: minWall,
      max: Math.max(minWall, Math.round(projectedTotalWallSec * (1 + uncertainty)))
    },
    costCents: {
      min: minCost,
      max: Math.max(minCost, Math.round(projectedTotalCostUsd * (1 + uncertainty) * 100))
    },
    behavior
  };
}

// Matches the tightest band estimateFromSample produces (a full sample, sampleRatio 1).
export const BASELINE_ESTIMATE_UNCERTAINTY = 0.2;

// Estimate from the reference run scaled by token count; only valid for the baseline model (e.g. cloud provider).
export function estimateFromBaseline({
  bookTokens
}: {
  bookTokens: number;
}): ImportEstimate | null {
  if (bookTokens <= 0) return null;

  const scale = bookTokens / BASELINE_MODEL_BOOK_TOKENS;
  const projectedTotalWallSec = scale * BASELINE_MODEL_PIPELINE_TOTAL_SEC;
  const projectedTotalCostUsd = scale * BASELINE_MODEL_PIPELINE_TOTAL_COST_USD;

  const uncertainty = BASELINE_ESTIMATE_UNCERTAINTY;
  const minWall = Math.max(1, Math.round(projectedTotalWallSec * (1 - uncertainty)));
  const minCost = Math.max(
    0,
    Math.round(projectedTotalCostUsd * (1 - uncertainty) * 100)
  );

  return {
    etaSeconds: {
      min: minWall,
      max: Math.max(minWall, Math.round(projectedTotalWallSec * (1 + uncertainty)))
    },
    costCents: {
      min: minCost,
      max: Math.max(minCost, Math.round(projectedTotalCostUsd * (1 + uncertainty) * 100))
    },
    behavior: 'normal'
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
