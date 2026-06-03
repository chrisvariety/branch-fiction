import { describe, expect, test } from 'vitest';

import { isStopword, partitionStopwords } from '../stop-words';

describe('isStopword', () => {
  test('flags subjective pronouns', () => {
    for (const name of ['I', 'you', 'he', 'she', 'it', 'we', 'they']) {
      expect(isStopword(name)).toBe(true);
    }
  });

  test('flags objective pronouns', () => {
    for (const name of ['me', 'him', 'her', 'us', 'them']) {
      expect(isStopword(name)).toBe(true);
    }
  });

  test('flags possessive and reflexive pronouns', () => {
    for (const name of ['his', 'hers', 'theirs', 'himself', 'herself', 'themselves']) {
      expect(isStopword(name)).toBe(true);
    }
  });

  test('flags demonstratives', () => {
    for (const name of ['this', 'that', 'these', 'those']) {
      expect(isStopword(name)).toBe(true);
    }
  });

  test('flags indefinite pronouns', () => {
    for (const name of ['someone', 'anyone', 'everyone', 'no one', 'nobody', 'nothing']) {
      expect(isStopword(name)).toBe(true);
    }
  });

  test('flags bare articles and conjunctions', () => {
    for (const name of ['the', 'a', 'an', 'and']) {
      expect(isStopword(name)).toBe(true);
    }
  });

  test('flags bare generic person nouns alone or with article', () => {
    expect(isStopword('man')).toBe(true);
    expect(isStopword('the man')).toBe(true);
    expect(isStopword('a boy')).toBe(true);
    expect(isStopword('the girl')).toBe(true);
    expect(isStopword('the child')).toBe(true);
  });

  test('keeps generic nouns with distinguishing modifiers', () => {
    expect(isStopword('old man')).toBe(false);
    expect(isStopword('the black dragon')).toBe(false);
    expect(isStopword('the only other black dragon')).toBe(false);
    expect(isStopword('the man with the scar')).toBe(false);
  });

  test('keeps kinship terms (downstream handles disambiguation)', () => {
    expect(isStopword('Mom')).toBe(false);
    expect(isStopword('Dad')).toBe(false);
    expect(isStopword('Father')).toBe(false);
    expect(isStopword('Auntie')).toBe(false);
  });

  test('keeps role and title terms', () => {
    expect(isStopword('the Guard')).toBe(false);
    expect(isStopword('the Captain')).toBe(false);
    expect(isStopword('the King')).toBe(false);
  });

  test('keeps proper nouns', () => {
    expect(isStopword('Aragorn')).toBe(false);
    expect(isStopword('Sarah')).toBe(false);
    expect(isStopword('morningstartail')).toBe(false);
  });

  test('is case insensitive', () => {
    expect(isStopword('HE')).toBe(true);
    expect(isStopword('The Man')).toBe(true);
    expect(isStopword('Themselves')).toBe(true);
  });

  test('ignores surrounding whitespace', () => {
    expect(isStopword('  he  ')).toBe(true);
    expect(isStopword(' the man ')).toBe(true);
  });
});

describe('partitionStopwords', () => {
  test('splits a mixed list, preserving order and original casing', () => {
    const { kept, dropped } = partitionStopwords([
      'the mysterious stranger',
      'Alice',
      'tall figure',
      'he'
    ]);
    expect(kept).toEqual(['the mysterious stranger', 'Alice', 'tall figure']);
    expect(dropped).toEqual(['he']);
  });

  test('all kept when no stopwords', () => {
    const names = ['Aragorn', 'the ranger', 'Strider'];
    const { kept, dropped } = partitionStopwords(names);
    expect(kept).toEqual(names);
    expect(dropped).toEqual([]);
  });

  test('all dropped when every name is a stopword', () => {
    const names = ['he', 'him', 'the man'];
    const { kept, dropped } = partitionStopwords(names);
    expect(kept).toEqual([]);
    expect(dropped).toEqual(names);
  });

  test('empty input', () => {
    expect(partitionStopwords([])).toEqual({ kept: [], dropped: [] });
  });
});
