export interface ChapterRange {
  startChapterIdx: number;
  endChapterIdx: number;
}

export function parseChapterRange(rangeStr: string, maxChapterIdx: number): ChapterRange {
  const trimmed = rangeStr.trim();

  // Validate input is not empty
  if (!trimmed) {
    throw new Error('Chapter range string cannot be empty');
  }

  // Handle open-ended range format: "22-36+"
  if (trimmed.includes('-') && trimmed.endsWith('+')) {
    const start = parseInt(trimmed.split('-')[0].trim(), 10);
    if (isNaN(start)) {
      throw new Error(
        `Invalid chapter range "${rangeStr}": start chapter is not a number`
      );
    }
    return {
      startChapterIdx: start,
      endChapterIdx: maxChapterIdx
    };
  }

  // Handle "end" keyword format: "34-end" or "12- end"
  const endMatch = trimmed.toLowerCase().match(/-\s*end$/);
  if (endMatch) {
    const start = parseInt(trimmed.slice(0, endMatch.index).trim(), 10);
    if (isNaN(start)) {
      throw new Error(
        `Invalid chapter range "${rangeStr}": start chapter is not a number`
      );
    }
    return {
      startChapterIdx: start,
      endChapterIdx: maxChapterIdx
    };
  }

  // Handle range format: "1-5"
  if (trimmed.includes('-')) {
    const [start, end] = trimmed.split('-').map((s) => parseInt(s.trim(), 10));
    if (isNaN(start) || isNaN(end)) {
      throw new Error(`Invalid chapter range "${rangeStr}": contains non-numeric values`);
    }
    return {
      startChapterIdx: start,
      endChapterIdx: end
    };
  }

  // Handle open-ended format: "5+"
  if (trimmed.endsWith('+')) {
    const start = parseInt(trimmed.slice(0, -1).trim(), 10);
    if (isNaN(start)) {
      throw new Error(
        `Invalid chapter range "${rangeStr}": start chapter is not a number`
      );
    }
    return {
      startChapterIdx: start,
      endChapterIdx: maxChapterIdx
    };
  }

  // Handle single chapter: "5"
  const chapter = parseInt(trimmed, 10);
  if (isNaN(chapter)) {
    throw new Error(`Invalid chapter range "${rangeStr}": not a valid number`);
  }
  return {
    startChapterIdx: chapter,
    endChapterIdx: chapter
  };
}
