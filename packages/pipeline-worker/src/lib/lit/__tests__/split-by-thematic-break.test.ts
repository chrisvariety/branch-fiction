import { describe, expect, test } from 'vitest';

import { THEMATIC_BREAK } from '@/app/lib/lit/chapter-to-markdown';

import { splitByThematicBreak } from '../split-by-thematic-break';

describe('splitByThematicBreak', () => {
  test('should split items by thematic break', () => {
    const items = [
      { content: 'First paragraph', bookParagraphIdx: 1, chapterIdx: 1 },
      { content: 'Second paragraph', bookParagraphIdx: 2, chapterIdx: 1 },
      { content: THEMATIC_BREAK, bookParagraphIdx: 3, chapterIdx: 1 },
      { content: 'Third paragraph', bookParagraphIdx: 4, chapterIdx: 1 },
      { content: 'Fourth paragraph', bookParagraphIdx: 5, chapterIdx: 1 }
    ];

    const result = splitByThematicBreak(items);

    expect(result).toEqual([
      {
        friendlyId: 1,
        startBookParagraphIdx: 1,
        endBookParagraphIdx: 2,
        chapterIdx: 1,
        content: ['First paragraph', 'Second paragraph']
      },
      {
        friendlyId: 2,
        startBookParagraphIdx: 4,
        endBookParagraphIdx: 5,
        chapterIdx: 1,
        content: ['Third paragraph', 'Fourth paragraph']
      }
    ]);
  });

  test('should handle multiple thematic breaks', () => {
    const items = [
      { content: 'First paragraph', bookParagraphIdx: 1, chapterIdx: 1 },
      { content: THEMATIC_BREAK, bookParagraphIdx: 2, chapterIdx: 1 },
      { content: 'Second paragraph', bookParagraphIdx: 3, chapterIdx: 1 },
      { content: THEMATIC_BREAK, bookParagraphIdx: 4, chapterIdx: 1 },
      { content: 'Third paragraph', bookParagraphIdx: 5, chapterIdx: 1 }
    ];

    const result = splitByThematicBreak(items);

    expect(result).toEqual([
      {
        friendlyId: 1,
        startBookParagraphIdx: 1,
        endBookParagraphIdx: 1,
        chapterIdx: 1,
        content: ['First paragraph']
      },
      {
        friendlyId: 2,
        startBookParagraphIdx: 3,
        endBookParagraphIdx: 3,
        chapterIdx: 1,
        content: ['Second paragraph']
      },
      {
        friendlyId: 3,
        startBookParagraphIdx: 5,
        endBookParagraphIdx: 5,
        chapterIdx: 1,
        content: ['Third paragraph']
      }
    ]);
  });

  test('should handle thematic break at the beginning', () => {
    const items = [
      { content: THEMATIC_BREAK, bookParagraphIdx: 1, chapterIdx: 1 },
      { content: 'First paragraph', bookParagraphIdx: 2, chapterIdx: 1 },
      { content: 'Second paragraph', bookParagraphIdx: 3, chapterIdx: 1 }
    ];

    const result = splitByThematicBreak(items);

    expect(result).toEqual([
      {
        friendlyId: 1,
        startBookParagraphIdx: 2,
        endBookParagraphIdx: 3,
        chapterIdx: 1,
        content: ['First paragraph', 'Second paragraph']
      }
    ]);
  });

  test('should handle thematic break at the end', () => {
    const items = [
      { content: 'First paragraph', bookParagraphIdx: 1, chapterIdx: 1 },
      { content: 'Second paragraph', bookParagraphIdx: 2, chapterIdx: 1 },
      { content: THEMATIC_BREAK, bookParagraphIdx: 3, chapterIdx: 1 }
    ];

    const result = splitByThematicBreak(items);

    expect(result).toEqual([
      {
        friendlyId: 1,
        startBookParagraphIdx: 1,
        endBookParagraphIdx: 2,
        chapterIdx: 1,
        content: ['First paragraph', 'Second paragraph']
      }
    ]);
  });

  test('should handle consecutive thematic breaks', () => {
    const items = [
      { content: 'First paragraph', bookParagraphIdx: 1, chapterIdx: 1 },
      { content: THEMATIC_BREAK, bookParagraphIdx: 2, chapterIdx: 1 },
      { content: THEMATIC_BREAK, bookParagraphIdx: 3, chapterIdx: 1 },
      { content: 'Second paragraph', bookParagraphIdx: 4, chapterIdx: 1 }
    ];

    const result = splitByThematicBreak(items);

    expect(result).toEqual([
      {
        friendlyId: 1,
        startBookParagraphIdx: 1,
        endBookParagraphIdx: 1,
        chapterIdx: 1,
        content: ['First paragraph']
      },
      {
        friendlyId: 2,
        startBookParagraphIdx: 4,
        endBookParagraphIdx: 4,
        chapterIdx: 1,
        content: ['Second paragraph']
      }
    ]);
  });

  test('should handle array with only thematic breaks', () => {
    const items = [
      { content: THEMATIC_BREAK, bookParagraphIdx: 1, chapterIdx: 1 },
      { content: THEMATIC_BREAK, bookParagraphIdx: 2, chapterIdx: 1 }
    ];

    const result = splitByThematicBreak(items);

    expect(result).toEqual([]);
  });

  test('should handle empty array', () => {
    const items: { content: string; bookParagraphIdx: number; chapterIdx: number }[] = [];

    const result = splitByThematicBreak(items);

    expect(result).toEqual([]);
  });

  test('should handle array with no thematic breaks', () => {
    const items = [
      { content: 'First paragraph', bookParagraphIdx: 1, chapterIdx: 1 },
      { content: 'Second paragraph', bookParagraphIdx: 2, chapterIdx: 1 },
      { content: 'Third paragraph', bookParagraphIdx: 3, chapterIdx: 1 }
    ];

    const result = splitByThematicBreak(items);

    expect(result).toEqual([
      {
        friendlyId: 1,
        startBookParagraphIdx: 1,
        endBookParagraphIdx: 3,
        chapterIdx: 1,
        content: ['First paragraph', 'Second paragraph', 'Third paragraph']
      }
    ]);
  });

  test('should use custom startFriendlyId parameter', () => {
    const items = [
      { content: 'First paragraph', bookParagraphIdx: 1, chapterIdx: 1 },
      { content: 'Second paragraph', bookParagraphIdx: 2, chapterIdx: 1 },
      { content: THEMATIC_BREAK, bookParagraphIdx: 3, chapterIdx: 1 },
      { content: 'Third paragraph', bookParagraphIdx: 4, chapterIdx: 1 },
      { content: 'Fourth paragraph', bookParagraphIdx: 5, chapterIdx: 1 }
    ];

    const result = splitByThematicBreak(items, 5);

    expect(result).toEqual([
      {
        friendlyId: 5,
        startBookParagraphIdx: 1,
        endBookParagraphIdx: 2,
        chapterIdx: 1,
        content: ['First paragraph', 'Second paragraph']
      },
      {
        friendlyId: 6,
        startBookParagraphIdx: 4,
        endBookParagraphIdx: 5,
        chapterIdx: 1,
        content: ['Third paragraph', 'Fourth paragraph']
      }
    ]);
  });

  test('should handle startFriendlyId with single group', () => {
    const items = [
      { content: 'First paragraph', bookParagraphIdx: 1, chapterIdx: 1 },
      { content: 'Second paragraph', bookParagraphIdx: 2, chapterIdx: 1 },
      { content: 'Third paragraph', bookParagraphIdx: 3, chapterIdx: 1 }
    ];

    const result = splitByThematicBreak(items, 10);

    expect(result).toEqual([
      {
        friendlyId: 10,
        startBookParagraphIdx: 1,
        endBookParagraphIdx: 3,
        chapterIdx: 1,
        content: ['First paragraph', 'Second paragraph', 'Third paragraph']
      }
    ]);
  });

  test('should handle startFriendlyId of 0', () => {
    const items = [
      { content: 'First paragraph', bookParagraphIdx: 1, chapterIdx: 1 },
      { content: 'Second paragraph', bookParagraphIdx: 2, chapterIdx: 1 }
    ];

    const result = splitByThematicBreak(items, 0);

    expect(result).toEqual([
      {
        friendlyId: 0,
        startBookParagraphIdx: 1,
        endBookParagraphIdx: 2,
        chapterIdx: 1,
        content: ['First paragraph', 'Second paragraph']
      }
    ]);
  });

  test('should handle items from different chapters', () => {
    const items = [
      { content: 'First paragraph', bookParagraphIdx: 1, chapterIdx: 1 },
      { content: 'Second paragraph', bookParagraphIdx: 2, chapterIdx: 1 },
      { content: THEMATIC_BREAK, bookParagraphIdx: 3, chapterIdx: 1 },
      { content: 'Third paragraph', bookParagraphIdx: 4, chapterIdx: 2 },
      { content: 'Fourth paragraph', bookParagraphIdx: 5, chapterIdx: 2 }
    ];

    const result = splitByThematicBreak(items);

    expect(result).toEqual([
      {
        friendlyId: 1,
        startBookParagraphIdx: 1,
        endBookParagraphIdx: 2,
        chapterIdx: 1,
        content: ['First paragraph', 'Second paragraph']
      },
      {
        friendlyId: 2,
        startBookParagraphIdx: 4,
        endBookParagraphIdx: 5,
        chapterIdx: 2,
        content: ['Third paragraph', 'Fourth paragraph']
      }
    ]);
  });
});
