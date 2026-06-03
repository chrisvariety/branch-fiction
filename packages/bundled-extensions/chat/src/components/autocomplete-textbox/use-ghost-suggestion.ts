import { useMemo } from 'react';

/**
 * Given the current text and a list of suggestions, returns the untyped
 * remainder of the best-matching suggestion, or null.
 *
 * Tries multi-word matches first (e.g. "Professor Thompson") then single-word.
 * Case-insensitive prefix matching.
 *
 * Example: findSuggestion("I talked to Pro", ["Professor Thompson"]) → "fessor Thompson"
 */
export function findSuggestion(text: string, suggestions: string[]): string | null {
  if (!text || suggestions.length === 0) return null;

  // Determine the max word count across all suggestions
  const maxWords = suggestions.reduce(
    (max, s) => Math.max(max, s.split(/\s+/).length),
    1
  );

  // Try longer trailing fragments first
  for (let n = maxWords; n >= 1; n--) {
    // Extract the last N words from text (preserving internal spacing)
    const match = text.match(new RegExp(`(?:^|\\s)((?:\\S+\\s+){${n - 1}}\\S+)$`));
    if (!match) continue;

    const fragment = match[1];
    if (fragment.length < 2) continue;
    const fragmentLower = fragment.toLowerCase();

    for (const suggestion of suggestions) {
      const suggestionLower = suggestion.toLowerCase();
      if (
        suggestionLower.startsWith(fragmentLower) &&
        suggestion.length > fragment.length
      ) {
        return suggestion.slice(fragment.length);
      }
    }
  }

  return null;
}

export function useGhostSuggestion(
  text: string,
  cursorAtEnd: boolean,
  suggestions: string[]
): string | null {
  return useMemo(() => {
    if (!cursorAtEnd) return null;
    return findSuggestion(text, suggestions);
  }, [text, cursorAtEnd, suggestions]);
}
