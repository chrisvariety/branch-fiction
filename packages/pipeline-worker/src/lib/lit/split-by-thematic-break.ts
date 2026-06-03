import { THEMATIC_BREAK } from '@/app/lib/lit/chapter-to-markdown';

export interface ThematicBreakGroup {
  friendlyId: number;
  startBookParagraphIdx: number;
  endBookParagraphIdx: number;
  chapterIdx: number;
  content: string[];
}

export function splitByThematicBreak(
  items: {
    content: string;
    bookParagraphIdx: number;
    chapterIdx: number;
  }[],
  startFriendlyId: number = 1
): ThematicBreakGroup[] {
  const thematicBreakGroups: ThematicBreakGroup[] = [];
  let currentContent: string[] = [];
  let currentStartIdx: number | null = null;
  let currentEndIdx: number | null = null;
  let currentChapterIdx: number | null = null;

  for (const item of items) {
    if (item.content === THEMATIC_BREAK) {
      if (
        currentContent.length > 0 &&
        currentStartIdx !== null &&
        currentEndIdx !== null &&
        currentChapterIdx !== null
      ) {
        thematicBreakGroups.push({
          friendlyId: startFriendlyId + thematicBreakGroups.length,
          startBookParagraphIdx: currentStartIdx,
          endBookParagraphIdx: currentEndIdx,
          chapterIdx: currentChapterIdx,
          content: currentContent
        });
        currentContent = [];
        currentStartIdx = null;
        currentEndIdx = null;
        currentChapterIdx = null;
      }
    } else {
      if (currentStartIdx === null) {
        currentStartIdx = item.bookParagraphIdx;
        currentChapterIdx = item.chapterIdx;
      }
      currentEndIdx = item.bookParagraphIdx;
      currentContent.push(item.content);
    }
  }

  if (
    currentContent.length > 0 &&
    currentStartIdx !== null &&
    currentEndIdx !== null &&
    currentChapterIdx !== null
  ) {
    thematicBreakGroups.push({
      friendlyId: startFriendlyId + thematicBreakGroups.length,
      startBookParagraphIdx: currentStartIdx,
      endBookParagraphIdx: currentEndIdx,
      chapterIdx: currentChapterIdx,
      content: currentContent
    });
  }

  return thematicBreakGroups;
}
