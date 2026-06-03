import { describe, expect, test } from 'vitest';

import { formatNameWithPhrasesMentioned, gatherMentions } from '../gather-mentions';

describe('gatherMentions', () => {
  test('should find entity by name', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: [], type: 'CHARACTER' },
      { id: '2', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'Alice went to the store.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Alice']
      }
    ]);
  });

  test('should find entity by alias', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: ['Ally', 'Al'], type: 'CHARACTER' },
      { id: '2', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'Ally went to the store with Al.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: ['Ally', 'Al'],
        type: 'CHARACTER',
        mentionCount: 2,
        phrasesMentioned: expect.arrayContaining(['Ally', 'Al'])
      }
    ]);
  });

  test('should find multiple different entities', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: [], type: 'CHARACTER' },
      { id: '2', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' },
      { id: '3', name: 'Charlie', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'Alice and Bob went to meet Charlie.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Alice']
      },
      {
        id: '2',
        name: 'Bob',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Bob']
      },
      {
        id: '3',
        name: 'Charlie',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Charlie']
      }
    ]);
  });

  test('should be case insensitive', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: [], type: 'CHARACTER' },
      { id: '2', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'alice and ALICE and AlIcE saw bob and BOB.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 3,
        phrasesMentioned: expect.arrayContaining(['alice', 'ALICE', 'AlIcE'])
      },
      {
        id: '2',
        name: 'Bob',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 2,
        phrasesMentioned: expect.arrayContaining(['bob', 'BOB'])
      }
    ]);
  });

  test('should handle word boundaries correctly', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: [], type: 'CHARACTER' },
      { id: '2', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'Alice saw Bobcat and Bobby, but not Bob.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Alice']
      },
      {
        id: '2',
        name: 'Bob',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Bob']
      }
    ]);
  });

  test('should return empty array when no entities are mentioned', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: [], type: 'CHARACTER' },
      { id: '2', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'Charlie went to the store.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([]);
  });

  test('should handle empty text', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: [], type: 'CHARACTER' },
      { id: '2', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = '';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([]);
  });

  test('should handle empty entities array', () => {
    const entities: {
      id: string;
      name: string;
      names: string[];
      aliases: string[];
      type: string;
    }[] = [];
    const text = 'Alice went to the store.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([]);
  });

  test('should handle entities with both name and alias mentioned', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: ['Ally'], type: 'CHARACTER' },
      { id: '2', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'Alice and Ally went together.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: ['Ally'],
        type: 'CHARACTER',
        mentionCount: 2,
        phrasesMentioned: expect.arrayContaining(['Alice', 'Ally'])
      }
    ]);
  });

  test('should handle multiple aliases for same entity', () => {
    const entities = [
      {
        id: '1',
        name: 'Alexander',
        names: [],
        aliases: ['Alex', 'Al', 'Xander'],
        type: 'CHARACTER'
      }
    ];
    const text = 'Alexander is also known as Alex, Al, and Xander.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alexander',
        names: [],
        aliases: ['Alex', 'Al', 'Xander'],
        type: 'CHARACTER',
        mentionCount: 4,
        phrasesMentioned: expect.arrayContaining(['Alexander', 'Alex', 'Al', 'Xander'])
      }
    ]);
  });

  test('should return unique entities even with multiple mentions', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: ['Ally'], type: 'CHARACTER' },
      { id: '2', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'Alice saw Ally. Ally met Alice. Bob saw Alice and Ally.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: ['Ally'],
        type: 'CHARACTER',
        mentionCount: 6,
        phrasesMentioned: expect.arrayContaining(['Alice', 'Ally'])
      },
      {
        id: '2',
        name: 'Bob',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Bob']
      }
    ]);
  });

  test('should handle entities with special regex characters in names', () => {
    const entities = [
      { id: '1', name: 'Mr. Smith', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'Mr. Smith went to the store.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Mr. Smith',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Mr. Smith']
      }
    ]);
  });

  test('should handle entities with special regex characters in aliases', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: ['$100'], type: 'CHARACTER' }
    ];
    const text = 'Alice owes $100 to the store.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: ['$100'],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Alice']
      }
    ]);
  });

  test('should work with custom entity types with additional properties', () => {
    const entities = [
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: ['Ally'],
        age: 25,
        role: 'protagonist',
        type: 'CHARACTER'
      },
      {
        id: '2',
        name: 'Bob',
        names: [],
        aliases: [],
        age: 30,
        role: 'antagonist',
        type: 'CHARACTER'
      }
    ];
    const text = 'Alice and Bob met at the park.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: ['Ally'],
        age: 25,
        role: 'protagonist',
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Alice']
      },
      {
        id: '2',
        name: 'Bob',
        names: [],
        aliases: [],
        age: 30,
        role: 'antagonist',
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Bob']
      }
    ]);
  });

  test('should match entity names without parentheticals', () => {
    const entities = [
      { id: '1', name: 'red sword', names: [], aliases: [], type: 'ITEM' },
      { id: '2', name: 'blue shield', names: [], aliases: [], type: 'ITEM' }
    ];
    const text = 'The red sword and blue shield were beautiful.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'red sword',
        names: [],
        aliases: [],
        type: 'ITEM',
        mentionCount: 1,
        phrasesMentioned: ['red sword']
      },
      {
        id: '2',
        name: 'blue shield',
        names: [],
        aliases: [],
        type: 'ITEM',
        mentionCount: 1,
        phrasesMentioned: ['blue shield']
      }
    ]);
  });

  test('should match entity names', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'Alice went to the store.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Alice']
      }
    ]);
  });

  test('should always include POV entities even if not mentioned in text', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: [], type: 'CHARACTER' },
      { id: '2', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'I went to see Bob at the store.'; // Uses "I" instead of "Alice"

    const result = Array.from(gatherMentions(text, entities, ['1']));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 0,
        phrasesMentioned: []
      },
      {
        id: '2',
        name: 'Bob',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Bob']
      }
    ]);
  });

  test('should not duplicate POV entities if they are also mentioned by name', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: [], type: 'CHARACTER' },
      { id: '2', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'Alice went to see Bob at the store.';

    const result = Array.from(gatherMentions(text, entities, ['1']));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 0,
        phrasesMentioned: []
      },
      {
        id: '2',
        name: 'Bob',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Bob']
      }
    ]);
  });

  test('should handle multiple POV entities', () => {
    const entities = [
      { id: '1', name: 'Alice', names: [], aliases: [], type: 'CHARACTER' },
      { id: '2', name: 'Charlie', names: [], aliases: [], type: 'CHARACTER' },
      { id: '3', name: 'Bob', names: [], aliases: [], type: 'CHARACTER' }
    ];
    const text = 'We saw Bob at the store.'; // "We" = Alice and Charlie

    const result = Array.from(gatherMentions(text, entities, ['1', '2']));

    expect(result).toEqual([
      {
        id: '1',
        name: 'Alice',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 0,
        phrasesMentioned: []
      },
      {
        id: '2',
        name: 'Charlie',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 0,
        phrasesMentioned: []
      },
      {
        id: '3',
        name: 'Bob',
        names: [],
        aliases: [],
        type: 'CHARACTER',
        mentionCount: 1,
        phrasesMentioned: ['Bob']
      }
    ]);
  });
  test('should match longer phrases before shorter substrings', () => {
    // This tests that "fire stone" is matched as a phrase, not just "fire"
    const entities = [
      {
        id: '1',
        name: 'fire',
        names: ['fire', 'flames'],
        aliases: [],
        type: 'ELEMENT'
      },
      {
        id: '2',
        name: 'fire stone',
        names: [],
        aliases: [],
        type: 'OBJECT'
      }
    ];
    const text = 'The knight carried a red fire stone on his belt.';

    const result = Array.from(gatherMentions(text, entities));

    // "fire stone" should match as a phrase, not just "fire"
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '2',
          name: 'fire stone',
          mentionCount: 1,
          phrasesMentioned: ['fire stone']
        })
      ])
    );
  });

  test('should match both short and long overlapping names when both appear', () => {
    const entities = [
      {
        id: '1',
        name: 'fire',
        names: ['fire', 'flames'],
        aliases: [],
        type: 'ELEMENT'
      },
      {
        id: '2',
        name: 'fire stone',
        names: [],
        aliases: [],
        type: 'OBJECT'
      }
    ];

    // This text has both "fire" (standalone) and "fire stone" (phrase)
    const text = 'The fire crackled loudly. Later, the mage examined her fire stone.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '1',
          name: 'fire',
          mentionCount: 1,
          phrasesMentioned: ['fire']
        }),
        expect.objectContaining({
          id: '2',
          name: 'fire stone',
          mentionCount: 1,
          phrasesMentioned: ['fire stone']
        })
      ])
    );
  });

  test('should find multiple entities with the same name/alias', () => {
    const entities = [
      { id: '1', name: 'Witch', names: [], aliases: ['The Witch'], type: 'CHARACTER' },
      { id: '2', name: 'Sorceress', names: [], aliases: ['The Witch'], type: 'CHARACTER' }
    ];
    const text = 'The Witch cast a spell.';

    const result = Array.from(gatherMentions(text, entities));

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        {
          id: '1',
          name: 'Witch',
          names: [],
          aliases: ['The Witch'],
          type: 'CHARACTER',
          mentionCount: 1,
          phrasesMentioned: ['The Witch']
        },
        {
          id: '2',
          name: 'Sorceress',
          names: [],
          aliases: ['The Witch'],
          type: 'CHARACTER',
          mentionCount: 1,
          phrasesMentioned: ['The Witch']
        }
      ])
    );
  });
});

describe('formatNameWithPhrasesMentioned', () => {
  test('should handle all formatting options correctly', () => {
    // Entity with only its own name mentioned - no phrases shown
    expect(
      formatNameWithPhrasesMentioned({
        name: 'Alice',
        phrasesMentioned: ['Alice']
      })
    ).toEqual({ friendlyId: '', name: 'Alice' });

    // Entity with one alternative phrase
    expect(
      formatNameWithPhrasesMentioned({
        name: 'Alice',
        phrasesMentioned: ['Ally']
      })
    ).toEqual({ friendlyId: '', name: 'Alice', phrasesUsed: 'Ally' });

    // Entity with multiple phrases
    expect(
      formatNameWithPhrasesMentioned({
        name: 'Alexander',
        phrasesMentioned: ['Alex', 'Al', 'Xander']
      })
    ).toEqual({ friendlyId: '', name: 'Alexander', phrasesUsed: 'Alex, Al, Xander' });

    // Entity with friendlyId
    expect(
      formatNameWithPhrasesMentioned({
        name: 'Alice',
        phrasesMentioned: ['Ally'],
        friendlyId: 'alice_123'
      })
    ).toEqual({ friendlyId: 'alice_123', name: 'Alice', phrasesUsed: 'Ally' });

    // Entity with empty phrasesMentioned
    expect(
      formatNameWithPhrasesMentioned({
        name: 'Alice',
        phrasesMentioned: []
      })
    ).toEqual({ friendlyId: '', name: 'Alice' });

    // Entity with friendlyId and no alternative phrases
    expect(
      formatNameWithPhrasesMentioned({
        name: 'Alice',
        phrasesMentioned: ['Alice'],
        friendlyId: 'alice_123'
      })
    ).toEqual({ friendlyId: 'alice_123', name: 'Alice' });
  });
});
