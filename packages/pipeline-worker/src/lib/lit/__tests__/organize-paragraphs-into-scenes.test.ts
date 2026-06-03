import { describe, expect, test } from 'vitest';

import { organizeParagraphsIntoScenes } from '../organize-paragraphs-into-scenes';

type Scene = {
  id: string;
  title?: string;
  startChapterParagraphId: string;
  endChapterParagraphId: string;
};

type Paragraph = {
  id: string;
  bookParagraphIdx: number;
  content?: string;
};

describe('organizeParagraphsIntoScenes', () => {
  test('groups paragraphs into scenes by inclusive bookParagraphIdx range', () => {
    const paragraphs: Paragraph[] = [
      { id: 'p1', bookParagraphIdx: 1 },
      { id: 'p2', bookParagraphIdx: 2 },
      { id: 'p3', bookParagraphIdx: 3 },
      { id: 'p4', bookParagraphIdx: 4 },
      { id: 'p5', bookParagraphIdx: 5 }
    ];

    const scenes: Scene[] = [
      {
        id: 's1',
        title: 'Scene 1',
        startChapterParagraphId: 'p1',
        endChapterParagraphId: 'p2'
      },
      {
        id: 's2',
        title: 'Scene 2',
        startChapterParagraphId: 'p3',
        endChapterParagraphId: 'p5'
      }
    ];

    const result = organizeParagraphsIntoScenes(scenes, paragraphs);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 's1', title: 'Scene 1' });
    expect(result[0].paragraphs.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(result[1]).toMatchObject({ id: 's2', title: 'Scene 2' });
    expect(result[1].paragraphs.map((p) => p.id)).toEqual(['p3', 'p4', 'p5']);
  });

  test('supports reversed boundary order (start after end)', () => {
    const paragraphs: Paragraph[] = [
      { id: 'p1', bookParagraphIdx: 10 },
      { id: 'p2', bookParagraphIdx: 11 },
      { id: 'p3', bookParagraphIdx: 12 }
    ];

    const scenes: Scene[] = [
      {
        id: 's1',
        startChapterParagraphId: 'p3',
        endChapterParagraphId: 'p1'
      }
    ];

    const result = organizeParagraphsIntoScenes(scenes, paragraphs);
    expect(result).toHaveLength(1);
    expect(result[0].paragraphs.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  test('throws when a boundary paragraph is missing', () => {
    const paragraphs: Paragraph[] = [
      { id: 'p1', bookParagraphIdx: 1 },
      { id: 'p2', bookParagraphIdx: 2 }
    ];

    const scenesMissingStart: Scene[] = [
      {
        id: 's1',
        startChapterParagraphId: 'missing',
        endChapterParagraphId: 'p2'
      }
    ];

    const scenesMissingEnd: Scene[] = [
      {
        id: 's2',
        startChapterParagraphId: 'p1',
        endChapterParagraphId: 'missing'
      }
    ];

    expect(() => organizeParagraphsIntoScenes(scenesMissingStart, paragraphs)).toThrow(
      /Scene boundary paragraph not found/
    );
    expect(() => organizeParagraphsIntoScenes(scenesMissingEnd, paragraphs)).toThrow(
      /Scene boundary paragraph not found/
    );
  });

  test('preserves additional scene properties and sorts paragraphs', () => {
    const paragraphs: Paragraph[] = [
      { id: 'p2', bookParagraphIdx: 2, content: 'Second' },
      { id: 'p1', bookParagraphIdx: 1, content: 'First' },
      { id: 'p3', bookParagraphIdx: 3, content: 'Third' }
    ];
    const scenes: Scene[] = [
      {
        id: 's1',
        title: 'Keep Me',
        startChapterParagraphId: 'p1',
        endChapterParagraphId: 'p3'
      }
    ];

    const result = organizeParagraphsIntoScenes(scenes, paragraphs);
    expect(result[0]).toMatchObject({ id: 's1', title: 'Keep Me' });
    expect(result[0].paragraphs.map((p) => p.content)).toEqual([
      'First',
      'Second',
      'Third'
    ]);
  });
});
