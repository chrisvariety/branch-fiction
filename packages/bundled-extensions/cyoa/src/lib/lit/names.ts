import pluralize from 'pluralize-esm';

export function entityNamesFormatted(entity: { name: string; names: string[] }) {
  const primaryName = entity.name;
  const additionalNames = entity.names.filter((name) => name !== primaryName);

  if (additionalNames.length === 0) {
    return primaryName;
  }

  if (additionalNames.length === 1)
    return `${primaryName} (Alias: ${additionalNames[0]})`;

  return `${primaryName} (Aliases: ${additionalNames.join(', ')})`;
}

export const normalizeName = (name: string) => {
  const trimmed = name.trim();
  // Replace fancy quotes with straight quotes
  const withStraightQuotes = trimmed
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
  const normalized = withStraightQuotes.toLowerCase().replace(/^the\s+/, '');

  // Only singularize if the original name doesn't start with a capital letter
  // (to avoid singularizing proper nouns like "Andreas" -> "Andrea")
  if (trimmed[0] && trimmed[0] === trimmed[0].toUpperCase()) {
    return normalized;
  }

  // Singularize each word in the name
  return normalized
    .split(/\s+/)
    .map((word) => pluralize.singular(word))
    .join(' ');
};
