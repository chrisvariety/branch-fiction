import uFuzzy from '@leeoniya/ufuzzy';

const ufStrict = new uFuzzy({
  intraMode: 1,
  intraIns: 1,
  intraSub: 1,
  intraTrn: 1,
  intraDel: 1,
  interIns: Infinity
});

const ufLoose = new uFuzzy({
  intraMode: 0,
  intraIns: 16,
  interIns: Infinity
});

function normalize(s: string): string {
  return s.replace(/_/g, ' ').trim();
}

function searchWith(uf: uFuzzy, haystack: string[], needle: string): number[] {
  const [idxs, , order] = uf.search(haystack, needle, 1, 1e5);
  if (!idxs || idxs.length === 0) return [];
  const ordered = order ?? idxs;
  const result: number[] = [];
  for (const idx of ordered) {
    result.push(order ? idxs[idx] : idx);
  }
  return result;
}

export function fuzzyMatchByKey<T>(
  items: T[],
  needle: string,
  getKey: (item: T) => string,
  limit = 5
): T[] {
  const normalized = normalize(needle);
  if (!normalized) return [];

  const haystack = items.map((item) => normalize(getKey(item)));

  const seen = new Set<number>();
  const collected: number[] = [];

  const collect = (idxs: number[]): boolean => {
    for (const idx of idxs) {
      if (!seen.has(idx)) {
        seen.add(idx);
        collected.push(idx);
        if (collected.length >= limit) return true;
      }
    }
    return false;
  };

  if (collect(searchWith(ufStrict, haystack, normalized))) {
    return collected.map((i) => items[i]);
  }
  if (collect(searchWith(ufLoose, haystack, normalized))) {
    return collected.map((i) => items[i]);
  }

  // Per-term fallback: partial-needle matches (e.g. "the_book" -> "great_green_book")
  const terms = normalized.split(/\s+/).filter((t) => t.length >= 4);
  for (const term of terms) {
    if (collect(searchWith(ufStrict, haystack, term))) break;
    if (collect(searchWith(ufLoose, haystack, term))) break;
  }

  return collected.map((i) => items[i]);
}
