import { organizeParagraphsIntoScenes } from '@/lib/lit/organize-paragraphs-into-scenes';
import { estimateTokens } from '@/lib/llm/estimate-tokens';

const TARGET_PASSAGE_TOKENS = 6_000;
const MIN_PASSAGE_TOKENS = 2_000;

/**
 * Groups scenes targeting ~6k tokens with a 2k minimum before splitting.
 * Returns groups of scene IDs.
 */
export function computeChapterSceneGroups(
  scenes: {
    id: string;
    startChapterParagraphId: string;
    endChapterParagraphId: string;
  }[],
  paragraphs: { id: string; bookParagraphIdx: number; content: string | null }[]
): string[][] {
  if (scenes.length === 0) return [];

  const scenesWithParagraphs = organizeParagraphsIntoScenes(scenes, paragraphs);

  const sceneGroups: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const scene of scenesWithParagraphs) {
    const sceneTokens = scene.paragraphs.reduce(
      (sum, p) => sum + estimateTokens(p.content || ''),
      0
    );

    if (
      current.length > 0 &&
      currentTokens + sceneTokens > TARGET_PASSAGE_TOKENS &&
      currentTokens >= MIN_PASSAGE_TOKENS
    ) {
      sceneGroups.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(scene.id);
    currentTokens += sceneTokens;
  }

  if (current.length > 0) {
    sceneGroups.push(current);
  }

  return sceneGroups;
}
