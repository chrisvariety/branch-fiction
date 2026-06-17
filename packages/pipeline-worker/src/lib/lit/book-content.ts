import type { AgentToolCall } from '@branch-fiction/extension-sdk/pi-ai';
import { UnrecoverableError } from '@branch-fiction/extension-sdk/worker/error-types';
import type { Agent, AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import dedent from 'dedent';

import type { Logger } from '@/workflow/handler';

import { getNonEmptyChapterParagraphsByChapterId } from '../db/models/chapter-paragraph/get-chapter-paragraph';
import { getChapterScenesByChapterId } from '../db/models/chapter-scene/get-chapter-scene';
import { getChapterByBookIdAndChapterIdx } from '../db/models/chapter/get-chapter';
import { organizeParagraphsIntoScenes } from './organize-paragraphs-into-scenes';

const CHAPTERS_TO_READ_DEFAULT = 5;

export async function getChapterContentText(
  bookId: string,
  chapterIdx: number
): Promise<string> {
  const chapter = await getChapterByBookIdAndChapterIdx(bookId, chapterIdx);
  if (!chapter) {
    throw new UnrecoverableError(`Chapter ${chapterIdx} not found`);
  }

  const paragraphs = await getNonEmptyChapterParagraphsByChapterId(chapter.id);
  const scenes = await getChapterScenesByChapterId(chapter.id);
  if (!scenes) {
    throw new UnrecoverableError(`Scenes not found for chapter ${chapterIdx}`);
  }

  const scenesWithParagraphs = organizeParagraphsIntoScenes(scenes, paragraphs);
  return scenesWithParagraphs
    .map((scene) => {
      const povText =
        scene.povEntity === 'Omniscient Narrator'
          ? scene.pov
          : `${scene.pov}, ${scene.povEntity}`;

      return dedent`<scene pov="${povText}">
        ${scene.paragraphs.map((paragraph) => paragraph.content).join('\n')}
      </scene>`;
    })
    .join('\n\n');
}

export async function getChapterRangeContentText(
  bookId: string,
  startChapter: number,
  endChapter: number
): Promise<string> {
  const parts: string[] = [];
  for (let idx = startChapter; idx <= endChapter; idx++) {
    const text = await getChapterContentText(bookId, idx);
    parts.push(`<chapter idx="${idx}">\n${text}\n</chapter>`);
  }
  return parts.join('\n\n');
}

export function createBookChapterContentAgentTool(bookId: string, maxChapter: number) {
  const parameters = Type.Object({
    chapterIdx: Type.Number({
      minimum: 1,
      maximum: maxChapter,
      description: `The chapter number to read (1-${maxChapter})`
    })
  });

  const agentTool: AgentTool<typeof parameters> = {
    name: 'book_chapter_content',
    label: 'Read Chapter',
    description: 'Get the content of a specific chapter from a book',
    parameters,
    execute: async (_id, params) => {
      const text = await getChapterContentText(bookId, params.chapterIdx);
      return { content: [{ type: 'text', text }], details: {} };
    }
  };

  return agentTool;
}

// Aborts when a single assistant turn fans out far past the per-round chapter budget.
export function abortOnExcessiveChapterCalls(agent: Agent, log: Logger): void {
  agent.subscribe((event) => {
    if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
    const chapterCalls = event.message.content.filter(
      (c) =>
        c.type === 'toolCall' &&
        (c.name === 'book_chapter_content' || c.name === 'book_chapter_range_content')
    );
    if (chapterCalls.length > Math.ceil(CHAPTERS_TO_READ_DEFAULT * 1.25)) {
      log.warn(`Too many tool calls at once: ${chapterCalls.length}`);
      agent.abort();
    }
  });
}

export function extractProcessedChapters(toolCalls: AgentToolCall[]): number[] {
  return toolCalls
    .flatMap((call) => {
      if (call.name === 'book_chapter_content') {
        const { chapterIdx } = call.args;
        if (typeof chapterIdx === 'number') {
          return [chapterIdx];
        }
      }

      if (call.name === 'book_chapter_range_content') {
        const { startChapter, endChapter } = call.args;
        if (typeof startChapter === 'number' && typeof endChapter === 'number') {
          return Array.from(
            { length: endChapter - startChapter + 1 },
            (_, i) => startChapter + i
          );
        }
      }

      return [];
    })
    .sort((a, b) => a - b);
}

export function findMissingChapterRange(
  processedChapters: number[],
  maxChapter: number
): { start: number; end: number; contextChapter?: number } | null {
  if (processedChapters.length === 0) {
    return { start: 1, end: maxChapter };
  }

  const uniqueChapters = [...new Set(processedChapters)].sort((a, b) => a - b);

  // Find the first gap or the next chapter after the last processed one
  for (let i = 1; i <= maxChapter; i++) {
    if (!uniqueChapters.includes(i)) {
      // Include the previous chapter for context if it exists
      const contextChapter = i > 1 ? i - 1 : undefined;
      return { start: i, end: maxChapter, contextChapter };
    }
  }

  return null; // All chapters processed
}

// read CHAPTERS_TO_READ_DEFAULT by default, unless there are fewer chapters left to read
export function minChaptersToRead(missingRange: { start: number; end: number }) {
  return Math.min(CHAPTERS_TO_READ_DEFAULT, missingRange.end - missingRange.start + 1);
}
