import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  character: v.object({
    friendlyId: v.string(),
    name: v.string()
  }),
  attributes: v.array(
    v.object({
      chapterIdx: v.number(),
      category: v.string(),
      name: v.string(),
      value: v.string(),
      evidence: v.string()
    })
  ),
  relatedEntityArcs: v.optional(
    v.array(
      v.object({
        friendlyId: v.string(),
        name: v.string(),
        type: v.string(),
        summary: v.string(),
        phrasesUsed: v.optional(v.string())
      })
    )
  ),
  appearanceHints: v.optional(
    v.array(
      v.object({
        name: v.string(),
        value: v.string(),
        source: v.picklist(['explicit', 'inferred'])
      })
    )
  ),
  minorUntilChapterIdx: v.optional(v.number())
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Character Appearance',
  input: InputSchema
};

const prompt = `You are an expert Concept Artist and Character Designer. Your task is to distill a collection of raw character attributes, gathered chronologically from a novel, into a cohesive, flowing visual description that would be maximally useful for an AI image generator or concept artist.

<character_data>
ID: {{ character.friendlyId }}
Name: {{ character.name }}

{% for attribute in attributes %}
Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
{% endfor %}
</character_data>

{% if appearanceHints and appearanceHints.length > 0 %}
<appearance_hints>
The following core appearance attributes have been pre-analyzed from the character data. These should be treated as the primary source of truth for each attribute listed. When raw attributes in <character_data> conflict with these hints, please prioritize the appearance hint values.

{% for hint in appearanceHints %}
- **{{ hint.name }}**: {{ hint.value }}
{% endfor %}
</appearance_hints>
{% endif %}

{% if relatedEntityArcs and relatedEntityArcs.length > 0 %}
<related_entities>
The following entities are related to {{ character.name }} and may provide valuable context for creating a more cohesive visual description:

{% for entity in relatedEntityArcs %}
<entity id="{{ entity.friendlyId }}" type="{{ entity.type }}"{% if entity.phrasesUsed %} phrases="{{ entity.phrasesUsed }}"{% endif %}>{{ entity.summary }}</entity>
{% endfor %}
</related_entities>

You have access to the following tool:
* \`lookup_related_entity_appearance({id: string})\`: Retrieves detailed visual information about a related entity using its ID from the list above.

**When to Use the Tool**: Use \`lookup_related_entity_appearance\` to gather visual details about items {{ character.name }} is wearing/carrying (weapons, armor, magical items, distinctive accessories), architectural elements, or magical elements that would appear in the scene. This is CRITICAL for producing accurate visual descriptions.

**When NOT to Use the Tool**: Skip abstract concepts, generic references, or entities without direct visual presence in the scene.
{% endif %}

{% if minorUntilChapterIdx %}
**Important**: {{ character.name }} was a minor (child) until Chapter {{ minorUntilChapterIdx }}. When creating the appearance description:
- Focus on their adult appearance (from Chapter {{ minorUntilChapterIdx }} onward)
- Do NOT describe their childhood appearance as the primary description
- You MAY include brief references to their childhood appearance for context (e.g., "Having grown from a freckled youth..."), but the description itself should represent them as an adult
- Prioritize attributes from Chapter {{ minorUntilChapterIdx }} and later when synthesizing the visual description

{% endif %}
Your objective is to synthesize these attributes into a vivid, flowing visual description focusing exclusively on appearance, atmosphere, and physical characteristics. Write in rich, concrete prose using specific language to describe physical features, clothing, equipment, colors, textures, and overall presence. Focus on what a camera would capture.

**Critical Instructions:**

1. **Exclusion Criteria (What to IGNORE)**:
   - Temporary conditions: battle damage, dirt, blood, weather effects, situational states
   - Transient elements: temporary injuries, bruises, minor cuts, emotional states (flushed, pale), exhaustion markers
   - Situational effects: time-specific conditions, current events
   - One-off descriptions that don't align with the overall pattern

2. **Include Only**: Permanent features, lasting characteristics, inherent properties, default state, consistent visual details mentioned across multiple chapters.

3. **Handling Permanent Changes**: If the character undergoes a lasting visual transformation, note it naturally in your description and mention the chapter where it occurs (e.g., "gains a jagged scar across the left cheek in Chapter 23" or "loses left arm after Chapter 15").

**Output Format:**

Create an XML document with the following structure:

\`\`\`xml
<appearance>
  <title>[Narratively descriptive phrase]</title>
  <detail>[Complete standalone visual description in flowing prose]</detail>
</appearance>
\`\`\`

The <appearance> element should contain:
1. **<title>**: A narratively descriptive few words capturing the essence of this character's appearance (e.g., "The silver-haired commander", "The battle-scarred warrior", "The young farm hand")
2. **<detail>**: A complete visual description written as flowing prose that integrates:
   - Overall visual archetype and impression
   - Height, body shape, build, and posture
   - Face shape, skin, eyes, hair, distinctive marks, and scars
   - Clothing layers, materials, colors, accessories, and equipment
   - Overall presence and visual mood

**Description Guidelines:**

- Write in flowing, vivid prose using concrete adjectives and specific nouns. Use parentheses to group secondary details with the primary feature they belong to, keeping descriptions scannable rather than a flat stream of comma-separated traits. For example: "muscular arms (crisscrossed with old battle scars)" or "leather armor (reinforced with steel plates, etched with geometric patterns)" keeps related details clustered and prevents ambiguity about what modifies what.
- Focus exclusively on visual details that can be depicted
- Avoid abstract concepts, personality traits, or motivations unless they manifest physically (e.g., "a perpetual scowl" is acceptable)
- For in-world terms (e.g., 'relic', 'sigil', 'wardstone'), you must provide a visual definition in parentheses immediately after the term first appears. For example: "...wears a silver glyph (a coin-sized magical symbol that glows faintly) on his lapel."
- Be specific with colors (e.g., "storm-gray," "emerald green," not just "blue" or "green")

**Example:**

<appearance>
<title>The silver-haired commander</title>
<detail>
Lyraen is a tall, imposing figure standing well over six feet, with a lean, muscular build (honed by years of combat in the Vanguard Legion). Her skin is a rich, dark bronze, contrasting sharply with striking silver-white hair (worn in a long braid down her back). Her angular face features high cheekbones, a strong jawline, piercing ice-blue eyes (faintly luminous in dim light), and a jagged scar from right temple to chin (a permanent mark from the battle with Warlord Kross in Chapter 15). She typically wears the Stormbreaker Armor, dark leather reinforced with blackened steel plates (intricately etched with protective runes—magical symbols that create a defensive barrier—that shimmer faintly blue), with Frostfang (a longsword with an ice-blue blade) at her hip. Her presence is commanding and severe, radiating quiet intensity and battle-hardened confidence.
</detail>
</appearance>

{% if relatedEntityArcs and relatedEntityArcs.length > 0 %}
**Workflow**: Before writing your final visual description, review the related_entities list and use the \`lookup_related_entity_appearance\` tool to gather details about any entities that would enhance your description of {{ character.name }}'s appearance.

{% endif %}
Your response must be valid XML following the format above, containing a single <appearance> element with <title> and <detail> tags.`;

export default createPrompt(meta, prompt);
