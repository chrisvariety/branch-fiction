import { describe, expect, test } from 'vitest';

import { parseChapterRange } from '../chapter-range';

describe('parseChapterRange', () => {
  test('should parse range format "1-5"', () => {
    const result = parseChapterRange('1-5', 10);
    expect(result).toEqual({ startChapterIdx: 1, endChapterIdx: 5 });
  });

  test('should parse open-ended format "5+"', () => {
    const result = parseChapterRange('5+', 10);
    expect(result).toEqual({ startChapterIdx: 5, endChapterIdx: 10 });
  });

  test('should parse single chapter "5"', () => {
    const result = parseChapterRange('5', 10);
    expect(result).toEqual({ startChapterIdx: 5, endChapterIdx: 5 });
  });

  test('should handle strings with whitespace', () => {
    const result = parseChapterRange('  3 - 7  ', 10);
    expect(result).toEqual({ startChapterIdx: 3, endChapterIdx: 7 });
  });

  test('should handle open-ended format with whitespace', () => {
    const result = parseChapterRange('  8 +  ', 15);
    expect(result).toEqual({ startChapterIdx: 8, endChapterIdx: 15 });
  });

  test('should handle single chapter with whitespace', () => {
    const result = parseChapterRange('  3  ', 10);
    expect(result).toEqual({ startChapterIdx: 3, endChapterIdx: 3 });
  });

  test('should handle large ranges', () => {
    const result = parseChapterRange('1-100', 200);
    expect(result).toEqual({ startChapterIdx: 1, endChapterIdx: 100 });
  });

  test('should use maxChapterIdx for open-ended ranges', () => {
    const result = parseChapterRange('50+', 100);
    expect(result).toEqual({ startChapterIdx: 50, endChapterIdx: 100 });
  });

  test('should parse open-ended range format "22-36+"', () => {
    const result = parseChapterRange('22-36+', 50);
    expect(result).toEqual({ startChapterIdx: 22, endChapterIdx: 50 });
  });

  test('should handle open-ended range with whitespace "10 - 20 +"', () => {
    const result = parseChapterRange('  10 - 20 +  ', 30);
    expect(result).toEqual({ startChapterIdx: 10, endChapterIdx: 30 });
  });

  test('should handle open-ended range with different max values', () => {
    const result = parseChapterRange('5-10+', 100);
    expect(result).toEqual({ startChapterIdx: 5, endChapterIdx: 100 });
  });

  test('should parse "34-end" format', () => {
    const result = parseChapterRange('34-end', 50);
    expect(result).toEqual({ startChapterIdx: 34, endChapterIdx: 50 });
  });

  test('should parse "12- end" format with space before end', () => {
    const result = parseChapterRange('12- end', 50);
    expect(result).toEqual({ startChapterIdx: 12, endChapterIdx: 50 });
  });
});
