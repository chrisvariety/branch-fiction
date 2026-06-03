import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  characters: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      description: v.nullish(v.string())
    })
  ),
  relationships: v.array(v.string()),
  relatedEntities: v.optional(
    v.array(
      v.object({
        friendlyId: v.string(),
        name: v.string(),
        type: v.string(),
        summary: v.string(),
        phrasesUsed: v.optional(v.string())
      })
    )
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Relationship Arc',
  input: InputSchema
};

const prompt = `You are analyzing relationship dynamics from a fantasy novel to create roleplay-ready relationship snapshots.

## Selectable Characters
The following characters can be selected by users for roleplay. Focus your analysis on relationships BETWEEN these characters:

<characters>
{% for character in characters %}
  <character id="{{ character.friendlyId }}">
    <name>{{ character.name }}</name>
    {% if character.description %}
      <description>{{ character.description }}</description>
    {% endif %}
  </character>
{% endfor %}
</characters>

## Relationship Data
The following relationship entries track how characters interact throughout the book. Each entry includes source character ID, target character ID, relationship type, chapter, and description.

<relationships>
{% for relationship in relationships %}
{{relationship}}
{% endfor %}
</relationships>

{% if relatedEntities and relatedEntities.length > 0 %}
<related_entities>
The following entities are related to these characters and may provide valuable context for understanding the relationship dynamics.

{% for entity in relatedEntities %}
<entity id="{{ entity.friendlyId }}" type="{{ entity.type }}"{% if entity.phrasesUsed %} phrases="{{ entity.phrasesUsed }}"{% endif %}>{{ entity.summary }}</entity>
{% endfor %}
</related_entities>

You have access to the following tool:
* \`lookup_related_entity({id: string})\`: Retrieves detailed information about a related entity using its ID from the list above.

**When to Use the Tool**: After reviewing the relationships and related entities, use \`lookup_related_entity\` to gather additional context about any related entities that significantly impact these relationship dynamics. For example:
- If a location serves as a significant setting for key relationship moments, look it up to understand the context
- If objects or artifacts play a role in bringing characters together or driving them apart, look them up for detailed context
- If other characters significantly influence the dynamic between the primary characters, look them up to understand their role
- If creatures, forces, or events mentioned in relationships affect the dynamic, look them up for details

**When NOT to Use the Tool**: Skip entities that are:
- Mentioned only in passing without significant impact on the relationship
- Generic or non-specific references
- Abstract concepts that don't have concrete manifestations

Use the tool strategically to enrich your understanding of how these relationships evolve with accurate, specific details about the entities that shape them.

**Workflow**: Before writing your final relationship arc snapshots, review the related_entities list and use the \`lookup_related_entity\` tool to gather details about any entities that would enhance your understanding of how these relationships transform throughout the story.

{% endif %}

## Task
Analyze the relationship data to identify:

1. **Character Combinations**: Which pairings (and notable groupings of three or more) have meaningful, evolving dynamics worth capturing
2. **Relationship Phases**: For each significant combination, the distinct phases their relationship goes through. Pay attention to phases defined by external circumstances (e.g., forced proximity, magical bonds, duty) that bridge the gap between "Enemies" and "Lovers."

### What to Include

**For pairs**, focus on relationships that:
- Have multiple interactions across chapters
- Show meaningful evolution OR deep, sustained reliance (e.g., bodyguard/charge, unbreakable loyalty)
- Involve characters who serve as emotional anchors or major sacrifices for the protagonist
- Would matter for roleplay scenarios (tension, attraction, conflict, protection, alliance, betrayal)

**For groups (three or more)**, focus on combinations where:
- The dynamic is MORE than the sum of the pairwise relationships
- There's a specific tension, triangle, or interplay that only exists when all are present
- The grouping appears or matters in the actual story

For pairs with minimal interaction or static dynamics, you may either create a single snapshot or omit them entirely. Do not force group dynamics that don't naturally exist in the story.

## Output Format
Return an XML document containing relationship snapshots.

\`\`\`xml
<snapshots>
  <snapshot>
    <character_id>character1_id</character_id>
    <character_id>character2_id</character_id>
    <phase>The Starting Dynamic (e.g., Lethal Distrust)</phase>
    <chapters>1-10</chapters>
    <detail>Write a single, flowing paragraph (or multiple connected paragraphs if needed) capturing the baseline tension. Describe the dynamic from ALL perspectives - the tension, attraction, resentment, trust, or complexity between them. Write in present tense. This should immediately convey what it feels like when these two characters are in a room together.</detail>
  </snapshot>
  <snapshot>
    <character_id>character1_id</character_id>
    <character_id>character2_id</character_id>
    <phase>The Shift (e.g., The Thawing)</phase>
    <chapters>11-25</chapters>
    <detail>Write a single, flowing paragraph (or multiple connected paragraphs if needed) capturing how the relationship has CHANGED from the previous phase. You must explicitly contrast current feelings with past ones (e.g., 'Where there was once fear, now there is distinct hesitation...'). Focus on what event or realization bridged the gap between the last phase and this one.</detail>
  </snapshot>
  <snapshot>
    <character_id>character1_id</character_id>
    <character_id>character2_id</character_id>
    <character_id>character3_id</character_id>
    <phase>The Starting Dynamic (e.g., Fractured Alliance)</phase>
    <chapters>4-15</chapters>
    <detail>Write a single, flowing paragraph (or multiple connected paragraphs if needed) capturing the unique dynamic when ALL these characters are present together. Focus on what emerges from their combination - the triangulated tension, competing loyalties, or complex interplay that doesn't exist in any single pairing. Write in present tense.</detail>
  </snapshot>
  <snapshot>
    <character_id>character1_id</character_id>
    <character_id>character2_id</character_id>
    <character_id>character3_id</character_id>
    <phase>The Shift (e.g., Unified Front)</phase>
    <chapters>16-30</chapters>
    <detail>[Same guidance as 2-character shift: explicitly contrast current feelings with past ones and focus on what bridged the gap.]</detail>
  </snapshot>
</snapshots>
\`\`\`

The <chapters> element should contain a chapter range in one of these formats:
- "1-5" for a specific range
- "1-end" for chapters from 1 to the last chapter
- "1" for a single chapter (rare for relationship arcs)

## Guidelines

### For Pairs
- Group all arcs for the same pair together in sequence.
- Focus on the DYNAMIC, not just individual feelings - relationships are bidirectional
- Capture subtext and tension (e.g., "hatred masking attraction" not just "hatred")
- If asymmetric (A loves B, B fears A), capture that complexity in the snapshot
- Do not overlook "Shadow" or "Protector" figures: If a character is assigned to guard another (e.g., a bodyguard), that is a critical dynamic for roleplay, even if they don't fight constantly.
- Cross-reference the Character List: Ensure that every character detailed in the <characters> block who plays a significant role in the plot appears in at least one meaningful arc.
- Create as many arcs as necessary to capture the genuine phases of each relationship; omit trivial pairs
- Chapter ranges should reflect genuine relationship shifts, not arbitrary divisions

### For Groups (Three or More)
- Only include groups where the combined dynamic is narratively significant
- The snapshot should capture what's UNIQUE about this combination
- Typically 1-2 arcs per group; these evolve less frequently than pairs
- Common patterns: love triangles, mentor/student/rival, family units, alliance factions
- If a group doesn't have a distinct dynamic beyond their pairwise relationships, don't include it

### General
- The snapshot should help a roleplayer understand how these characters would interact RIGHT NOW
- Use vivid, evocative language that matches the book's tone
- For in-world terms (e.g., 'relic', 'sigil', 'channeling'), provide a definition in parentheses immediately after the term first appears

Your response must be valid XML following the format above, containing a single <snapshots> element with one or more <snapshot> children, each with one or more <character_id> tags (using the character IDs from the character list above), followed by <phase>, <chapters>, and <detail> tags.
`;

export default createPrompt(meta, prompt);
