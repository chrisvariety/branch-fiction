// Finds book entities mentioned by name/alias within a block of text.
export function gatherMentions<
  T extends {
    id: string;
    name: string;
    names: string[];
    aliases: string[];
    type: string;
  }
>(
  text: string,
  bookEntities: T[]
): Set<T & { mentionCount: number; phrasesMentioned: string[] }> {
  if (bookEntities.length === 0) {
    return new Set();
  }

  const mentionData = new Map<string, { count: number; phrases: Set<string> }>();

  const searchableNames: { entity: T; searchName: string }[] = [];
  bookEntities.forEach((entity) => {
    const uniqueNames = new Set([
      entity.name,
      ...(entity.names || []),
      ...(entity.aliases || [])
    ]);
    uniqueNames.forEach((name) => {
      if (name.trim() !== '') {
        searchableNames.push({ entity, searchName: name });
      }
    });
  });

  type Match = { start: number; end: number; text: string; entity: T };
  const allMatches: Match[] = [];

  for (const { entity, searchName } of searchableNames) {
    const regex = new RegExp(`\\b${RegExp.escape(searchName)}\\b`, 'gim');
    let match;
    while ((match = regex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        entity
      });
    }
  }

  allMatches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });

  let lastEnd = -1;
  let lastStart = -1;
  let lastLength = -1;
  for (const match of allMatches) {
    const matchLength = match.end - match.start;
    const isNewPosition = match.start >= lastEnd;
    const isSameMatch = match.start === lastStart && matchLength === lastLength;

    if (isNewPosition || isSameMatch) {
      const data = mentionData.get(match.entity.id) || {
        count: 0,
        phrases: new Set<string>()
      };
      data.count++;
      data.phrases.add(match.text);
      mentionData.set(match.entity.id, data);

      if (isNewPosition) {
        lastEnd = match.end;
        lastStart = match.start;
        lastLength = matchLength;
      }
    }
  }

  const foundEntities = new Set<
    T & { mentionCount: number; phrasesMentioned: string[] }
  >();
  mentionData.forEach((data, entityId) => {
    const entity = bookEntities.find((e) => e.id === entityId);
    if (entity) {
      foundEntities.add({
        ...entity,
        mentionCount: data.count,
        phrasesMentioned: Array.from(data.phrases)
      });
    }
  });

  return foundEntities;
}
