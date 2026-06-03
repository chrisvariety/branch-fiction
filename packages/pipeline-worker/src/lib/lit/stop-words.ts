// English pronouns and bare generic nouns that match too much of any book's text
// to reliably identify a single entity. Non-English forms and rarer edge cases
// are handled by a separate piTextLight pass at the end of entity extraction.

const STOPWORD_NAMES = new Set<string>([
  // Subjective pronouns
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  // Objective pronouns
  'me',
  'him',
  'her',
  'us',
  'them',
  // Possessive determiners and pronouns
  'my',
  'your',
  'his',
  'its',
  'our',
  'their',
  'mine',
  'yours',
  'hers',
  'ours',
  'theirs',
  // Reflexive pronouns
  'myself',
  'yourself',
  'himself',
  'herself',
  'itself',
  'ourselves',
  'yourselves',
  'themselves',
  // Demonstratives
  'this',
  'that',
  'these',
  'those',
  // Indefinite pronouns
  'someone',
  'somebody',
  'anyone',
  'anybody',
  'everyone',
  'everybody',
  'no one',
  'nobody',
  'something',
  'anything',
  'everything',
  'nothing',
  // Bare articles and conjunctions
  'a',
  'an',
  'the',
  'and',
  // Bare common nouns for an undifferentiated person (with no distinguishing modifier)
  'man',
  'woman',
  'boy',
  'girl',
  'child',
  'person'
]);

function normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/, '');
}

export function isStopword(name: string): boolean {
  return STOPWORD_NAMES.has(normalize(name));
}

export function partitionStopwords(names: string[]): {
  kept: string[];
  dropped: string[];
} {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const name of names) {
    if (isStopword(name)) dropped.push(name);
    else kept.push(name);
  }
  return { kept, dropped };
}
