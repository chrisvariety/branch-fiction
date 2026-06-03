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
  bookEntities: T[],
  povBookEntityIds?: string[]
): Set<T & { mentionCount: number; phrasesMentioned: string[] }> {
  if (bookEntities.length === 0) {
    return new Set();
  }

  // Track counts and phrases for each entity
  const mentionData = new Map<string, { count: number; phrases: Set<string> }>();

  // Initialize POV entities with count of 0 (included by default, not from mentions)
  if (povBookEntityIds && povBookEntityIds.length > 0) {
    povBookEntityIds.forEach((id) => {
      mentionData.set(id, { count: 0, phrases: new Set() });
    });
  }

  const searchableNames: { entity: T; searchName: string }[] = [];
  bookEntities.forEach((entity) => {
    if (povBookEntityIds?.includes(entity.id)) {
      return; // Skip POV entities - no point in searching for them as they're already included
    }

    const uniqueNames = new Set([
      entity.name,
      ...(entity.names || []),
      ...(entity.aliases || [])
    ]);
    uniqueNames.forEach((name) => {
      if (name.trim() !== '') {
        searchableNames.push({
          entity,
          searchName: name
        });
      }
    });
  });

  // Find all matches for each searchable name independently
  type Match = {
    start: number;
    end: number;
    text: string;
    entity: T;
  };
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

  // Sort by start position, then by length (longest first) for overlapping matches
  allMatches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    // For same start position, prefer longer matches
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

  // Create augmented entities with mention counts and phrases
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

export function formatNameWithPhrasesMentioned(entity: {
  name: string;
  phrasesMentioned: string[];
  friendlyId?: string;
}): { friendlyId: string; name: string; phrasesUsed?: string } {
  // Only include phrases if they exist and are not just the entity name
  const shouldShowPhrases =
    entity.phrasesMentioned &&
    entity.phrasesMentioned.length > 0 &&
    !(entity.phrasesMentioned.length === 1 && entity.phrasesMentioned[0] === entity.name);

  return {
    friendlyId: entity.friendlyId || '',
    name: entity.name,
    ...(shouldShowPhrases && { phrasesUsed: entity.phrasesMentioned.join(', ') })
  };
}
