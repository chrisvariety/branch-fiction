import {
  BASELINE_MODEL_BEHAVIOR_REFERENCE,
  BASELINE_MODEL_PIPELINE_TOTAL_SEC,
  BASELINE_MODEL_STEP_COST_SHARE,
  BASELINE_MODEL_STEP_WALL_SEC,
  MIN_CALLS_FOR_CLASSIFICATION,
  OUTPUT_RATIO_MAX_MULTIPLIER,
  SEC_PER_CALL_MAX_MULTIPLIER,
  clamp,
  type Behavior,
  type CostRange,
  type EtaRange
} from '@/app/lib/llm/baseline-model';

type StepProjection = {
  behavior: Behavior;
  eta: EtaRange | null;
  cost: CostRange | null;
};

export type ProjectionUpdate = {
  eta: EtaRange;
  cost: CostRange | null;
  behavior: Behavior;
};

type ReportCtx = {
  metricsThisStep: () => { calls: number; outputTokens: number; costUsd: number };
  updateProjection: (update: ProjectionUpdate) => void;
};

// Project ETA + cost from in-handler progress and push the result to the bridge.
// Wraps the work every long-running handler would otherwise duplicate.
export function reportStepProgress(
  ctx: ReportCtx,
  {
    stepId,
    stepStartMs,
    fractionOfStepComplete,
    bookTokens
  }: {
    stepId: string;
    stepStartMs: number;
    fractionOfStepComplete: number;
    bookTokens: number;
  }
): void {
  const metrics = ctx.metricsThisStep();
  const elapsedInStepSec = (Date.now() - stepStartMs) / 1000;
  const { eta, cost, behavior } = projectStepProgress({
    stepId,
    elapsedInStepSec,
    fractionOfStepComplete,
    observedCostUsd: metrics.costUsd,
    calls: metrics.calls,
    outputTokens: metrics.outputTokens,
    bookTokens
  });
  if (eta) ctx.updateProjection({ eta, cost, behavior });
}

function projectStepProgress({
  stepId,
  elapsedInStepSec,
  fractionOfStepComplete,
  observedCostUsd,
  calls,
  outputTokens,
  bookTokens
}: {
  stepId: string;
  elapsedInStepSec: number;
  fractionOfStepComplete: number;
  observedCostUsd: number;
  calls: number;
  outputTokens: number;
  bookTokens: number;
}): StepProjection {
  return {
    behavior: classifyBehavior({
      stepId,
      wallSec: elapsedInStepSec,
      calls,
      outputTokens,
      bookTokens
    }),
    eta: projectEtaFromStepProgress({
      stepId,
      elapsedInStepSec,
      fractionOfStepComplete
    }),
    cost: projectCostFromStepProgress({
      stepId,
      observedCostUsd,
      fractionOfStepComplete
    })
  };
}

function classifyBehavior({
  stepId,
  wallSec,
  calls,
  outputTokens,
  bookTokens
}: {
  stepId: string;
  wallSec: number;
  calls: number;
  outputTokens: number;
  bookTokens: number;
}): Behavior {
  const ref = BASELINE_MODEL_BEHAVIOR_REFERENCE[stepId];
  if (!ref || calls < MIN_CALLS_FOR_CLASSIFICATION || bookTokens === 0) {
    return 'unknown';
  }

  const observedSecPerCall = wallSec / calls;
  const observedOutputRatio = outputTokens / bookTokens;

  const inSecBand = observedSecPerCall <= ref.secPerCall * SEC_PER_CALL_MAX_MULTIPLIER;
  const inOutputBand =
    observedOutputRatio <= ref.outputPerBookToken * OUTPUT_RATIO_MAX_MULTIPLIER;

  return inSecBand && inOutputBand ? 'normal' : 'unknown';
}

function projectEtaFromStepProgress({
  stepId,
  elapsedInStepSec,
  fractionOfStepComplete
}: {
  stepId: string;
  elapsedInStepSec: number;
  fractionOfStepComplete: number;
}): EtaRange | null {
  const stepBaseline = BASELINE_MODEL_STEP_WALL_SEC[stepId];
  if (!stepBaseline || fractionOfStepComplete <= 0 || elapsedInStepSec <= 0) {
    return null;
  }

  const projectedStepSec = elapsedInStepSec / fractionOfStepComplete;
  const stepShare = stepBaseline / BASELINE_MODEL_PIPELINE_TOTAL_SEC;
  const projectedTotalSec = projectedStepSec / stepShare;

  const observedFraction = Math.min(1, stepShare * fractionOfStepComplete);
  const uncertainty = clamp(1 - 2 * observedFraction, 0.15, 0.5);

  const minSeconds = Math.max(1, Math.round(projectedTotalSec * (1 - uncertainty)));
  return {
    minSeconds,
    maxSeconds: Math.max(minSeconds, Math.round(projectedTotalSec * (1 + uncertainty)))
  };
}

function projectCostFromStepProgress({
  stepId,
  observedCostUsd,
  fractionOfStepComplete
}: {
  stepId: string;
  observedCostUsd: number;
  fractionOfStepComplete: number;
}): CostRange | null {
  const stepShare = BASELINE_MODEL_STEP_COST_SHARE[stepId];
  if (!stepShare || fractionOfStepComplete <= 0 || observedCostUsd <= 0) {
    return null;
  }

  const projectedStepCost = observedCostUsd / fractionOfStepComplete;
  const projectedTotalCost = projectedStepCost / stepShare;

  const observedFraction = Math.min(1, stepShare * fractionOfStepComplete);
  const uncertainty = clamp(1 - 2 * observedFraction, 0.15, 0.5);

  const minCents = Math.max(0, Math.round(projectedTotalCost * (1 - uncertainty) * 100));
  return {
    minCents,
    maxCents: Math.max(minCents, Math.round(projectedTotalCost * (1 + uncertainty) * 100))
  };
}
