import { queryOptions } from '@tanstack/react-query';

import { getBookCharacterPlaceScoresByBookId } from '@/iframe/db/models/book-character-place-score/get-book-character-place-score';
import { getBookInteractiveEntitiesWithEntityByInteractiveId } from '@/iframe/db/models/book-interactive-entity/get-book-interactive-entity';
import { getActiveBookInteractiveByBookIdAndKind } from '@/iframe/db/models/book-interactive/get-book-interactive';
import { getBookSummaryById } from '@/iframe/db/models/book/get-book';
import type { Point } from '@/lib/db/types';

export type BookInteractiveEntity = {
  id: string;
  clickArea: string | null;
  headArea: string | null;
  bookEntity: {
    id: string;
    name: string;
    identityTag: string | null;
    significanceRank: number | null;
    imageUrl: string | null;
  } | null;
};

export type BookInteractive = {
  id: string;
  url: string | null;
  videoUrl: string | null;
  width: number | null;
  height: number | null;
  bookInteractiveEntities: BookInteractiveEntity[];
};

export type CharacterPlaceScore = {
  characterBookEntityId: string;
  placeBookEntityId: string;
  score: number;
};

export type BookData = {
  book: { id: string; title: string; slug: string };
  characterInteractive: BookInteractive;
  placeInteractive: BookInteractive;
  characterPlaceScores: CharacterPlaceScore[];
};

function pointsToSvg(points: Point[] | null): string | null {
  if (!points || points.length === 0) return null;
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

async function fetchInteractive(
  bookId: string,
  kind: 'character' | 'place'
): Promise<BookInteractive | null> {
  const interactive = await getActiveBookInteractiveByBookIdAndKind(bookId, kind);
  if (!interactive) return null;

  const entityRows = await getBookInteractiveEntitiesWithEntityByInteractiveId(
    interactive.id
  );

  const bookInteractiveEntities = entityRows
    .map<BookInteractiveEntity>((row) => ({
      id: row.id,
      clickArea: pointsToSvg(row.clickArea),
      headArea: pointsToSvg(row.headArea),
      bookEntity: row.entityName
        ? {
            id: row.bookEntityId,
            name: capitalize(row.entityName),
            identityTag: row.entityIdentityTag,
            significanceRank: row.entitySignificanceRank,
            imageUrl: row.headImageUrl ?? row.imageUrl
          }
        : null
    }))
    .sort(
      (a, b) =>
        (a.bookEntity?.significanceRank ?? Infinity) -
        (b.bookEntity?.significanceRank ?? Infinity)
    );

  return {
    id: interactive.id,
    url: interactive.url,
    videoUrl: interactive.videoUrl,
    width: interactive.width,
    height: interactive.height,
    bookInteractiveEntities
  };
}

async function fetchBookData(bookId: string): Promise<BookData> {
  const book = await getBookSummaryById(bookId);
  if (!book) throw new Error('Book not found');

  const [characterInteractive, placeInteractive, characterPlaceScores] =
    await Promise.all([
      fetchInteractive(bookId, 'character'),
      fetchInteractive(bookId, 'place'),
      getBookCharacterPlaceScoresByBookId(bookId)
    ]);
  if (!characterInteractive) throw new Error('Character interactive not found');
  if (!placeInteractive) throw new Error('Place interactive not found');

  return {
    book: { id: book.id, title: book.title, slug: book.slug },
    characterInteractive,
    placeInteractive,
    characterPlaceScores: characterPlaceScores.map((row) => ({
      characterBookEntityId: row.characterBookEntityId,
      placeBookEntityId: row.placeBookEntityId,
      score: Number(row.score)
    }))
  };
}

export function bookDataQueryOptions(bookId: string) {
  return queryOptions({
    queryKey: ['book-data', bookId] as const,
    queryFn: () => fetchBookData(bookId)
  });
}
