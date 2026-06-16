/**
 * Computes PRIMARY/SECONDARY mention-count thresholds via z-scores in log-space,
 * respecting the Zipfian distribution of entity mentions across a book.
 */
export function entityThresholds(
  counts: number[],
  primaryZScore: number = 1.5,
  secondaryZScore: number = 0.5
): {
  primaryThreshold: number;
  secondaryThreshold: number;
} {
  if (counts.length === 0) return { primaryThreshold: 0, secondaryThreshold: 0 };
  if (counts.length === 1)
    return { primaryThreshold: counts[0], secondaryThreshold: counts[0] };

  // 1. Log-transform all counts (use ln(x + 1) to avoid ln(0))
  const logs = counts.map((c) => Math.log(c + 1));

  // 2. Calculate mean in log-space
  const mean = logs.reduce((sum, val) => sum + val, 0) / logs.length;

  // 3. Calculate variance and standard deviation in log-space
  const variance =
    logs.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / logs.length;
  const std = Math.sqrt(variance);

  // 4. Compute thresholds in log-space using z-scores
  // Both thresholds above mean to capture only above-average entities
  const logPrimaryThreshold = mean + primaryZScore * std;
  const logSecondaryThreshold = mean + secondaryZScore * std;

  // 5. Convert back to original scale
  const primaryThreshold = Math.exp(logPrimaryThreshold) - 1;
  const secondaryThreshold = Math.exp(logSecondaryThreshold) - 1;

  return { primaryThreshold, secondaryThreshold };
}
