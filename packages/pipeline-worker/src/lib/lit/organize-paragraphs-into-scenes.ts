// Group chapter paragraphs by their corresponding scenes using inclusive bookParagraphIdx ranges

export function organizeParagraphsIntoScenes<
  S extends {
    id: string;
    startChapterParagraphId: string;
    endChapterParagraphId: string;
  },
  P extends { id: string; bookParagraphIdx: number }
>(scenes: S[], paragraphs: P[]): Array<S & { paragraphs: P[] }> {
  const paragraphById = new Map<string, P>(paragraphs.map((p) => [p.id, p]));

  return scenes.map((scene) => {
    const start = paragraphById.get(scene.startChapterParagraphId)?.bookParagraphIdx;
    const end = paragraphById.get(scene.endChapterParagraphId)?.bookParagraphIdx;

    if (start === undefined || end === undefined) {
      throw new Error(
        `Scene boundary paragraph not found: ${scene.startChapterParagraphId} or ${scene.endChapterParagraphId}`
      );
    }

    const [lo, hi] = start <= end ? [start, end] : [end, start];

    const sceneParagraphs = paragraphs
      .filter((p) => p.bookParagraphIdx >= lo && p.bookParagraphIdx <= hi)
      .sort((a, b) => a.bookParagraphIdx - b.bookParagraphIdx);

    return { ...scene, paragraphs: sceneParagraphs };
  });
}
