import uFuzzy from '@leeoniya/ufuzzy';

const uf = new uFuzzy({
  intraMode: 1,
  intraIns: 1,
  intraSub: 1,
  intraTrn: 1,
  intraDel: 1,
  interIns: Infinity
});

/**
 * Detects if the user's action text mentions entities that are not currently
 * in the chat scene. Returns an INTERNAL_CONTENT message string if out-of-scene
 * entities are detected, or null otherwise.
 */
export function detectOutOfSceneMentions<
  T extends { id: string; name: string; names: string[]; type: string }
>(
  action: string,
  entitiesToSearch: T[],
  alreadyMentionedEntityIds: Set<string>
): { message: string; bookEntityIds: string[] } | null {
  if (entitiesToSearch.length === 0) return null;

  // Search for each entity name within the action text
  const haystack = [action];
  const matched = new Map<string, { entity: T; matchedName: string }>();

  for (const entity of entitiesToSearch) {
    if (alreadyMentionedEntityIds.has(entity.id)) continue;
    const searchNames = new Set([entity.name, ...entity.names]);
    for (const name of searchNames) {
      const [idxs] = uf.search(haystack, name, 1, 1e5);
      if (idxs && idxs.length > 0) {
        matched.set(entity.id, { entity, matchedName: name });
        break;
      }
    }
  }

  if (matched.size === 0) return null;

  const actionLower = action.toLowerCase();
  const mentions = Array.from(matched.values()).map(({ entity, matchedName }) => {
    const primaryNameInAction = actionLower.includes(entity.name.toLowerCase());
    const matchedIsPrimaryName = matchedName.toLowerCase() === entity.name.toLowerCase();
    return primaryNameInAction || matchedIsPrimaryName
      ? entity.name
      : `${entity.name} (mentioned as '${matchedName}')`;
  });

  const bookEntityIds = Array.from(matched.keys());
  const allCharacters = Array.from(matched.values()).every(
    ({ entity }) => entity.type === 'character'
  );
  const noun = allCharacters ? 'character' : 'entity';
  const visualExclusion = allCharacters
    ? 'do NOT include them in the `generate_visual` character_ids or describe their physical appearance in the visual prompt'
    : 'do NOT include them in `generate_visual` in any way';

  if (mentions.length === 1) {
    return {
      message: `The user mentioned ${mentions[0]}. This ${noun} is not currently in the scene — ${visualExclusion}. You may reference them in narration or dialogue. A follow-up internal event message will provide their appearance details if they enter the scene.`,
      bookEntityIds
    };
  }

  const nounPlural = allCharacters ? 'characters' : 'entities';
  return {
    message: `The user mentioned the following ${nounPlural}: ${mentions.join(', ')}. These ${nounPlural} are not currently in the scene — ${visualExclusion}. You may reference them in narration or dialogue. A follow-up internal event message will provide appearance details for any who enter the scene.`,
    bookEntityIds
  };
}
