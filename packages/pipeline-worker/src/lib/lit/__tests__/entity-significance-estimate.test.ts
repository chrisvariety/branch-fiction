import { describe, expect, test } from 'vitest';

import { entityThresholds } from '../entity-significance-estimate';

describe('entityThresholds', () => {
  test('should handle empty array', () => {
    const result = entityThresholds([]);
    expect(result).toEqual({ primaryThreshold: 0, secondaryThreshold: 0 });
  });

  test('should handle single element', () => {
    const result = entityThresholds([100]);
    expect(result).toEqual({ primaryThreshold: 100, secondaryThreshold: 100 });
  });

  test('should return sensible thresholds for typical book distribution', () => {
    // Real mention counts from a book - power-law distribution typical of entity mentions
    const counts = [
      507, 463, 323, 233, 174, 170, 153, 140, 140, 127, 114, 101, 100, 99, 95, 91, 75, 74,
      63, 62, 58, 54, 53, 52, 51, 47, 47, 45, 44, 43, 38, 37, 37, 33, 31, 31, 27, 26, 25,
      24, 23, 23, 23, 22, 21, 19, 19, 19, 18, 18, 18, 17, 17, 17, 16, 16, 16, 16, 16, 16,
      15, 15, 14, 14, 14, 14, 14, 13, 13, 13, 13, 13, 12, 12, 12, 12, 12, 11, 11, 11, 11,
      11, 11, 10, 10, 10, 10, 9, 9, 9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6,
      6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3,
      3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
    ];

    const result = entityThresholds(counts);

    expect(result.primaryThreshold).toBeGreaterThan(0);
    expect(result.secondaryThreshold).toBeGreaterThan(0);

    expect(result.primaryThreshold).toBeGreaterThan(result.secondaryThreshold);

    expect(result.secondaryThreshold).toBeGreaterThan(13);

    const primaryCount = counts.filter((c) => c >= result.primaryThreshold).length;
    expect(primaryCount).toBeLessThan(counts.length * 0.3);

    const secondaryCount = counts.filter((c) => c >= result.secondaryThreshold).length;
    expect(secondaryCount).toBeLessThan(counts.length * 0.5);
  });

  test('should handle uniform distribution', () => {
    const counts = [10, 10, 10, 10, 10];
    const result = entityThresholds(counts);

    expect(result.primaryThreshold).toBeCloseTo(10, 1);
    expect(result.secondaryThreshold).toBeCloseTo(10, 1);
  });
});
