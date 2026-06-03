import { type AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import dedent from 'dedent';

import { getBookEntitiesByBookId } from '@/lib/db/models/book-entity/get-book-entity';
import {
  findCharacterIdsByContextKeywords,
  searchAttributesByBookEntityIdsAndKeywords
} from '@/lib/db/models/chapter-entity-attribute/get-chapter-entity-attribute';

import { gatherMentions } from './gather-mentions';

const lookupCharacterAttributeSchema = Type.Object({
  character_name: Type.String({
    description:
      'The name of the character whose attributes you want to look up (e.g., "Killian" if resolving "shorter than Killian")'
  }),
  attribute_keywords: Type.Array(Type.String(), {
    description:
      'Keywords to search for in the attribute name, value, and evidence fields (e.g., ["height", "tall", "short", "feet", "inches"] for height comparisons)'
  })
});

export function createLookupCharacterAttributeTool(
  bookId: string,
  excludeEntity?: { id: string; name: string }
): AgentTool<typeof lookupCharacterAttributeSchema> {
  return {
    name: 'lookup_other_character_attribute',
    label: 'Lookup Other Character Attribute',
    description:
      'Looks up attributes for a named character mentioned in a comparison. Use for comparison-based inference when an attribute references another character (e.g., "shorter than Killian", "eyes darker than Marcus", "older than her brother Theo") to find their explicit values and infer the current character\'s value.',
    parameters: lookupCharacterAttributeSchema,
    execute: async (_id, args) => {
      const { character_name, attribute_keywords } = args;

      if (excludeEntity && character_name === excludeEntity.name) {
        throw new Error(
          `You cannot look up "${character_name}" because that is the character currently being processed. This tool is for looking up OTHER characters mentioned in comparative attributes (e.g., if an attribute says "shorter than Killian", use this tool to look up Killian's height, not the current character's height).`
        );
      }

      const allEntities = await getBookEntitiesByBookId(bookId);
      const characters = allEntities.filter((e) => e.type === 'CHARACTER');

      const matches = gatherMentions(character_name, characters);

      if (matches.size === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No character found matching "${character_name}". Please check the spelling or try a different name/alias.`
            }
          ],
          details: {}
        };
      }

      const matchedIds = Array.from(matches).map((m) => m.id);

      const attributes = await searchAttributesByBookEntityIdsAndKeywords(
        matchedIds,
        attribute_keywords,
        ['PHYSICAL', 'MAGICAL'],
        excludeEntity?.id
      );

      if (attributes.length === 0) {
        const matchedNames = Array.from(matches)
          .map((m) => m.name)
          .join(', ');
        return {
          content: [
            {
              type: 'text',
              text: `No attributes matching [${attribute_keywords.join(', ')}] found for ${matchedNames}.`
            }
          ],
          details: {}
        };
      }

      const byCharacter = new Map<
        string,
        { name: string; friendlyId: string; attrs: typeof attributes }
      >();

      for (const attr of attributes) {
        const key = attr.bookEntityId;
        if (!byCharacter.has(key)) {
          byCharacter.set(key, {
            name: attr.characterName ?? 'Unknown',
            friendlyId: attr.characterFriendlyId ?? '',
            attrs: []
          });
        }
        const group = byCharacter.get(key)!;
        if (group.attrs.length < 10) {
          group.attrs.push(attr);
        }
      }

      const primaryKeyword =
        attribute_keywords[0]?.toLowerCase().replace(/\s+/g, '_') || 'attribute';
      const resultTag = `${primaryKeyword}_comparison_result`;
      const resultsTag = `${primaryKeyword}_comparison_results`;

      const resultElements: string[] = [];

      for (const [, { name, attrs }] of byCharacter) {
        for (const a of attrs) {
          resultElements.push(
            `<${resultTag} name="${name}">Chapter ${a.chapterIdx}: ${a.category} - ${a.name}: ${a.value} (${a.evidence})</${resultTag}>`
          );
        }
      }

      const text = dedent`<${resultsTag}>
        ${resultElements.join('\n')}
        </${resultsTag}>`;

      return { content: [{ type: 'text', text }], details: {} };
    }
  };
}

const searchCharacterAttributesSchema = Type.Object({
  context_keywords: Type.Array(Type.String(), {
    description:
      'Keywords that describe the context or group (e.g., ["first-year", "freshman"] to find first-year students)'
  }),
  attribute_keywords: Type.Array(Type.String(), {
    description:
      'Keywords for the attribute you want to find (e.g., ["age", "years old", "born"] to find age information)'
  })
});

export function createSearchCharacterAttributesTool(
  bookId: string,
  excludeBookEntityId?: string
): AgentTool<typeof searchCharacterAttributesSchema> {
  return {
    name: 'search_character_attributes',
    label: 'Search Character Attributes',
    description:
      'Searches for characters sharing a context (title, rank, role, or class) and returns their attributes. Use for context-based inference when a character has contextual terms like "first-year student", "senior apprentice", or "veteran soldier" to find what values other characters with that same context have.',
    parameters: searchCharacterAttributesSchema,
    execute: async (_id, args) => {
      const { context_keywords, attribute_keywords } = args;

      const matchingCharacters = await findCharacterIdsByContextKeywords(
        bookId,
        context_keywords,
        excludeBookEntityId
      );

      if (matchingCharacters.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No characters found with attributes matching context [${context_keywords.join(', ')}].`
            }
          ],
          details: {}
        };
      }

      const characterIds = matchingCharacters.map((c) => c.id);
      const attributes = await searchAttributesByBookEntityIdsAndKeywords(
        characterIds,
        attribute_keywords,
        ['PHYSICAL', 'MAGICAL'],
        excludeBookEntityId
      );

      if (attributes.length === 0) {
        const characterNames = matchingCharacters.map((c) => c.name).join(', ');
        return {
          content: [
            {
              type: 'text',
              text: `Found ${matchingCharacters.length} characters matching context [${context_keywords.join(', ')}] (${characterNames}), but none have attributes matching [${attribute_keywords.join(', ')}].`
            }
          ],
          details: {}
        };
      }

      const byCharacter = new Map<
        string,
        { name: string; friendlyId: string; attrs: typeof attributes }
      >();

      for (const attr of attributes) {
        const key = attr.bookEntityId;
        if (!byCharacter.has(key)) {
          byCharacter.set(key, {
            name: attr.characterName ?? 'Unknown',
            friendlyId: attr.characterFriendlyId ?? '',
            attrs: []
          });
        }
        const group = byCharacter.get(key)!;
        if (group.attrs.length < 10) {
          group.attrs.push(attr);
        }
      }

      const primaryKeyword =
        attribute_keywords[0]?.toLowerCase().replace(/\s+/g, '_') || 'attribute';
      const resultTag = `${primaryKeyword}_search_result`;
      const resultsTag = `${primaryKeyword}_search_results`;

      const resultElements: string[] = [];

      for (const [, { name, attrs }] of byCharacter) {
        for (const a of attrs) {
          resultElements.push(
            `<${resultTag} name="${name}">Chapter ${a.chapterIdx}: ${a.category} - ${a.name}: ${a.value} (${a.evidence})</${resultTag}>`
          );
        }
      }

      const text = dedent`<${resultsTag}>
        ${resultElements.join('\n')}
        </${resultsTag}>`;

      return { content: [{ type: 'text', text }], details: {} };
    }
  };
}
