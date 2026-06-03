type FriendlyIdEntity = { id: string; friendlyId: string; bookId: string };

/**
 * Builds a map from entity id to friendlyId, prefixing with a book index
 * when multiple books are involved (friendlyIds could overlap across books, e.g. two books with a "jane").
 * Single-book scenarios leave friendlyIds unchanged.
 */
export function buildFriendlyIdMap(entities: FriendlyIdEntity[]): Map<string, string> {
  const bookIdxMap = getBookIdxMap(entities);
  const result = new Map<string, string>();
  for (const entity of entities) {
    result.set(entity.id, prefixFriendlyId(entity.friendlyId, entity.bookId, bookIdxMap));
  }
  return result;
}

/**
 * Resolves a list of (possibly prefixed) friendlyIds back to matching entities.
 * Uses the same sorted book index mapping as buildFriendlyIdMap.
 */
export function resolveEntitiesByFriendlyIds<T extends FriendlyIdEntity>(
  entities: T[],
  friendlyIds: string[]
): T[] {
  const bookIdxMap = getBookIdxMap(entities);
  const byFriendlyId = new Map<string, T>();
  for (const entity of entities) {
    byFriendlyId.set(
      prefixFriendlyId(entity.friendlyId, entity.bookId, bookIdxMap),
      entity
    );
  }
  const result: T[] = [];
  for (const fid of friendlyIds) {
    const entity = byFriendlyId.get(fid);
    if (entity) result.push(entity);
  }
  return result;
}

/**
 * Strips any `\d+_` book index prefix from friendlyIds.
 * Hopefully friendlyIds don't naturally start with a number followed by an underscore!
 */
export function stripFriendlyIdPrefixes(friendlyIds: string[]): string[] {
  return friendlyIds.map((fid) => fid.replace(/^\d+_/, ''));
}

function getBookIdxMap(entities: FriendlyIdEntity[]): Map<string, number> | undefined {
  const uniqueBookIds = [...new Set(entities.map((e) => e.bookId))].sort();
  if (uniqueBookIds.length <= 1) return undefined;
  return new Map(uniqueBookIds.map((id, i) => [id, i + 1]));
}

function prefixFriendlyId(
  friendlyId: string,
  bookId: string,
  bookIdxMap?: Map<string, number>
) {
  return bookIdxMap ? `${bookIdxMap.get(bookId)}_${friendlyId}` : friendlyId;
}
