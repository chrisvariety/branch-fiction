import uFuzzy from '@leeoniya/ufuzzy';

type BookEntityLike = { id: string; name: string; names: string[] };

const uf = new uFuzzy({
  intraMode: 1,
  intraIns: 1,
  intraSub: 1,
  intraTrn: 1,
  intraDel: 1,
  interIns: Infinity
});

export function fuzzyMatchBookEntities<T extends BookEntityLike>(
  bookEntities: T[],
  searchString: string
): T[] {
  const haystack: string[] = [];
  const entityIndexMap: number[] = [];

  for (let i = 0; i < bookEntities.length; i++) {
    const allNames = new Set([bookEntities[i].name, ...bookEntities[i].names]);
    for (const name of allNames) {
      haystack.push(name);
      entityIndexMap.push(i);
    }
  }

  const [idxs, , order] = uf.search(haystack, searchString, 1, 1e5);

  if (!idxs || idxs.length === 0) return [];

  const seen = new Set<number>();
  const results: T[] = [];

  const indices = order ?? idxs;
  for (const idx of indices) {
    const haystackIdx = order ? idxs[idx] : idx;
    const entityIdx = entityIndexMap[haystackIdx];
    if (!seen.has(entityIdx)) {
      seen.add(entityIdx);
      results.push(bookEntities[entityIdx]);
    }
  }

  return results;
}
