import slug from 'slug';

export async function generateUniqueFriendlyPrefix({
  typePrefix,
  entities,
  checkCollision
}: {
  typePrefix: string;
  entities: { id: string; name: string }[];
  checkCollision: (prefix: string) => Promise<boolean>;
}): Promise<string> {
  const entityNames = entities.map((e) => e.name).filter((name) => name);

  if (entityNames.length === 0) {
    throw new Error('No valid entity names found for the provided entities');
  }

  // Slug all entity names once and convert to word arrays
  const entitySlugWords = entityNames.map((name) => {
    const slugged = slug(name);
    return slugged.split('-').filter((word) => word.length > 0);
  });

  const maxWords = Math.max(...entitySlugWords.map((words) => words.length));

  for (let numWords = 1; numWords <= Math.min(maxWords, 10); numWords++) {
    const initials = generateCombinedMultiWordInitials(entitySlugWords, numWords);
    const prefix = `${typePrefix}-${initials}-`;

    const hasCollision = await checkCollision(prefix);
    if (!hasCollision) {
      return prefix;
    }
  }

  // Strategy 2: Fall back to progressively expanding initials from first word
  for (let initialLength = 2; initialLength <= 10; initialLength++) {
    const initials = generateCombinedInitials(entitySlugWords, initialLength);
    const prefix = `${typePrefix}-${initials}-`;

    const hasCollision = await checkCollision(prefix);
    if (!hasCollision) {
      return prefix;
    }
  }

  const uniqueSuffix = entities.map((e) => e.id.slice(-4)).join('');
  return `${typePrefix}-${uniqueSuffix}-`;
}

// helpers for friendlyId
function generateInitials(words: string[], length: number = 1): string {
  if (words.length === 0) return '';

  // Get first N characters of first word
  return words[0].substring(0, length).toUpperCase();
}

/**
 * Extract initials from multiple slugged words.
 * Takes the first letter from each of the first N words.
 * e.g., ["victorian", "explorer", "detective"] with numWords=2 => "VE"
 */
function generateMultiWordInitials(words: string[], numWords: number = 1): string {
  if (words.length === 0) return '';

  // Get first letter from each of the first N words
  return words
    .slice(0, numWords)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function generateCombinedInitials(
  entitySlugWords: string[][],
  length: number = 1
): string {
  if (!entitySlugWords || entitySlugWords.length === 0) return '';

  const limited = entitySlugWords.slice(0, 5); // Max 5 entities
  return limited.map((words) => generateInitials(words, length)).join('');
}

function generateCombinedMultiWordInitials(
  entitySlugWords: string[][],
  numWords: number = 1
): string {
  if (!entitySlugWords || entitySlugWords.length === 0) return '';

  const limited = entitySlugWords.slice(0, 5); // Max 5 entities
  return limited.map((words) => generateMultiWordInitials(words, numWords)).join('');
}
