import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/llm/estimate-tokens', () => ({
  estimateTokens: (text: string) => Math.ceil(text.length / 4)
}));

import { computeChapterSceneGroups } from '../chapter-scene-groups';

// mocked estimateTokens = Math.ceil(text.length / 4), so 'x'.repeat(n * 4) ≈ n tokens
let nextIdx = 0;

function makeScene(id: string, tokens: number) {
  const startIdx = nextIdx;
  nextIdx++;

  return {
    scene: {
      id,
      startChapterParagraphId: `p-${id}`,
      endChapterParagraphId: `p-${id}`
    },
    paragraph: {
      id: `p-${id}`,
      bookParagraphIdx: startIdx,
      content: 'x'.repeat(tokens * 4)
    }
  };
}

function setup(entries: { id: string; tokens: number }[]) {
  nextIdx = 0;
  const items = entries.map((e) => makeScene(e.id, e.tokens));
  return {
    scenes: items.map((i) => i.scene),
    paragraphs: items.map((i) => i.paragraph)
  };
}

describe('computeChapterSceneGroups', () => {
  test('returns empty array for no scenes', () => {
    expect(computeChapterSceneGroups([], [])).toEqual([]);
  });

  test('single small scene returns one passage', () => {
    const { scenes, paragraphs } = setup([{ id: 'a', tokens: 1000 }]);
    expect(computeChapterSceneGroups(scenes, paragraphs)).toEqual([['a']]);
  });

  test('groups small scenes together up to target', () => {
    const { scenes, paragraphs } = setup([
      { id: 'a', tokens: 2000 },
      { id: 'b', tokens: 2000 },
      { id: 'c', tokens: 2000 }
    ]);
    expect(computeChapterSceneGroups(scenes, paragraphs)).toEqual([['a', 'b', 'c']]);
  });

  test('splits when exceeding target and minimum is met', () => {
    const { scenes, paragraphs } = setup([
      { id: 'a', tokens: 3000 },
      { id: 'b', tokens: 3000 },
      { id: 'c', tokens: 4000 }
    ]);
    expect(computeChapterSceneGroups(scenes, paragraphs)).toEqual([['a', 'b'], ['c']]);
  });

  test('does not split when current is below minimum', () => {
    const { scenes, paragraphs } = setup([
      { id: 'a', tokens: 1000 },
      { id: 'b', tokens: 6000 }
    ]);
    expect(computeChapterSceneGroups(scenes, paragraphs)).toEqual([['a', 'b']]);
  });

  test('handles multiple splits across many scenes', () => {
    const { scenes, paragraphs } = setup([
      { id: 'a', tokens: 3000 },
      { id: 'b', tokens: 3000 },
      { id: 'c', tokens: 3000 },
      { id: 'd', tokens: 3000 },
      { id: 'e', tokens: 3000 }
    ]);
    expect(computeChapterSceneGroups(scenes, paragraphs)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e']
    ]);
  });

  test('single large scene stays in its own passage', () => {
    const { scenes, paragraphs } = setup([
      { id: 'a', tokens: 3000 },
      { id: 'b', tokens: 15000 },
      { id: 'c', tokens: 3000 }
    ]);
    expect(computeChapterSceneGroups(scenes, paragraphs)).toEqual([['a'], ['b'], ['c']]);
  });
});
