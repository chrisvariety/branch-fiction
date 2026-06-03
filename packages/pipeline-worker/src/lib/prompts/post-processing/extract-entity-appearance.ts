import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  entity: v.object({
    friendlyId: v.string(),
    name: v.string(),
    type: v.string()
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
  name: 'Extract Entity Appearance',
  input: InputSchema
};

const prompt = `You are a Visual Design Specialist. Your task is to distill a collection of raw entity attributes, gathered chronologically from a novel, into a cohesive, flowing visual description that would be maximally useful for an AI image generator or concept artist.

<entity_data>
ID: {{ entity.friendlyId }}
Name: {{ entity.name }}
Type: {{ entity.type }}

{% for attribute in attributes %}
Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
{% endfor %}
</entity_data>

{% if relatedEntities and relatedEntities.length > 0 %}
<related_entities>
The following entities are related to {{ entity.name }} and may provide valuable context for creating a more cohesive visual description.

{% for entity in relatedEntities %}
<entity id="{{ entity.friendlyId }}" type="{{ entity.type }}"{% if entity.phrasesUsed %} phrases="{{ entity.phrasesUsed }}"{% endif %}>{{ entity.summary }}</entity>
{% endfor %}
</related_entities>

You have access to the following tool:
* \`lookup_related_entity({id: string})\`: Retrieves detailed information about a related entity using its ID from the list above.

**When to Use the Tool**: After reviewing the entity_data and related_entities, use \`lookup_related_entity\` to gather additional visual details about any related entities that directly impact {{ entity.name }}'s appearance or context. For example:
- If {{ entity.name }} is a location that contains specific architectural elements or decorative items, look up those items to learn their precise visual details
- If {{ entity.name }} is an object associated with a specific character or organization, look up that entity to understand visual motifs, colors, or insignia that should be reflected
- If {{ entity.name }} is part of a larger structure or system, look up related entities to ensure visual consistency and coherence
- If {{ entity.name }} has adjacent or nearby entities that influence its visual presentation, look them up for contextual details

**When NOT to Use the Tool**: Skip entities that are:
- Abstract concepts or relationships that don't have visual manifestations
- Generic or non-specific references without distinct visual characteristics
- Characters who don't contribute visual elements to {{ entity.name }}'s description
- Entities mentioned only in passing without direct visual connection

Use the tool strategically to enrich your visual description with accurate, specific details that make the entity description more vivid and contextually coherent.
{% endif %}

Your objective is to synthesize these attributes into a vivid, flowing visual description focusing exclusively on appearance, atmosphere, and physical characteristics. Write in rich, concrete prose using specific language to describe scale, materials, colors, textures, and overall presence. Focus on what a camera would capture.

**Critical Instructions:**

1. **Detect Shared vs. Unique Entities**: First, analyze the entity_data to determine if this entity is shared across multiple characters or unique to one. Look for evidence in the attributes like "describes [Character A]'s [entity]" or "[entity] on [Character B]". If multiple characters are mentioned, this is a SHARED entity type.

2. **For Shared Entities - Generalize**: Create a generalized description focusing on the common features across all instances. Do NOT describe any specific character's version. You may mention the range of variation (e.g., "typically extends from wrist to shoulder, though coverage varies by individual").

3. **For Unique Entities - Be Specific**: If the entity belongs to only one character, create a normal specific description including all relevant details.

4. **Exclusion Criteria (What to IGNORE)**:
   - Temporary conditions: battle damage, weather effects, situational states
   - Transient elements: temporary decorations, visiting characters, current events
   - Situational lighting: time-specific conditions unless they're the default state
   - One-off descriptions that don't align with the overall pattern

5. **Include Only**: Permanent features, lasting characteristics, inherent properties, default state, consistent visual details mentioned across multiple chapters.

6. **Handling Permanent Changes**: If the entity undergoes a lasting visual transformation, note it naturally in your description and mention the chapter where it occurs (e.g., "gains a jagged scar across the left cheek in Chapter 23" or "the tower crumbles into ruins after Chapter 42").

**Output Format:**

Create an XML document with the following structure:

\`\`\`xml
<appearance>
  <title>[Narratively descriptive phrase]</title>
  <detail>[Complete standalone visual description in flowing prose]</detail>
</appearance>
\`\`\`

The <appearance> element should contain:
1. **<title>**: A narratively descriptive few words capturing the essence of this entity's appearance (e.g., "The obsidian fortress", "The battle-scarred warrior", "The corrupted blade")
2. **<detail>**: A complete visual description written as flowing prose that integrates:
   - Overall visual identity and impression
   - Overall size, shape, and structural design
   - Materials and surface qualities
   - Color palette and light sources
   - Decorative elements, state of repair, and visual mood

**Description Guidelines:**

- Write in flowing, vivid prose using concrete language to describe scale, material, light, color, and condition
- Focus exclusively on what a camera would see
- For in-world terms (e.g., 'starcrystal', 'wards', 'essence-forged'), you must provide a visual definition in parentheses immediately after the term first appears. For example: "...the walls are lined with wardstones (fist-sized crystals that pulse with protective blue light) at regular intervals."
- Be specific with colors (e.g., "storm-gray," "emerald green," not just "blue" or "green")

**Example for a location:**

<appearance>
<title>The obsidian fortress</title>
<detail>
The Shadowspire is a colossal fortress carved directly from midnight-black obsidian, rising like a jagged blade from the barren mountain peak. Its scale is overwhelming—easily the size of a small city—with a main tower that pierces the clouds and four lesser spires radiating outward like the points of a crown. The obsidian surface is smoothly polished in places, reflecting distorted light, while other sections are rough-hewn and ancient, covered in intricate runic carvings that glow faintly with a deep crimson light. The entire structure emanates an oppressive darkness, its sharp angles and severe geometry creating deep, knife-edge shadows. Heavy iron gates, pitted and scorched from centuries of use, guard the main entrance, flanked by massive siege ballistae that can swivel to target any approach. Narrow windows puncture the walls at irregular intervals, each one backlit by flickering torchlight from within. At the fortress's highest point, Lord Malachar's personal banner—a crimson serpent on black silk—snaps in the perpetual wind. The atmosphere is one of ancient, merciless power—a place built by the First Warlock to intimidate and endure.
</detail>
</appearance>

**Example for an object:**

<appearance>
<title>The corrupted blade</title>
<detail>
The Soulsever is a longsword of elegant yet menacing design, measuring approximately four feet from pommel to tip. Originally forged by Master Artificer Torin for the Paladin Order, the blade was later corrupted in the Abyssal Forge. The blade itself is forged from an otherworldly black steel that seems to absorb light rather than reflect it, with a slight curve along its length and a razor-sharp edge that gleams with a faint purple sheen. Running down the center of the blade is a deep groove (called a fuller) inlaid with silver runes that pulse with a sickly violet light in the presence of magic. The crossguard is wrought iron shaped into twisting thorns, cold to the touch and etched with smaller warding symbols. The grip is wrapped in dark leather, worn smooth from centuries of use by Captain Vex and her predecessors, while the pommel features a smooth black gemstone (a soulstone that can trap and consume souls) that occasionally swirls with trapped wisps of gray mist. The entire weapon radiates a palpable sense of malevolence and hunger, and the air around it seems slightly colder and heavier.
</detail>
</appearance>

{% if relatedEntities and relatedEntities.length > 0 %}
**Workflow**: Before writing your final visual description, review the related_entities list and use the \`lookup_related_entity\` tool to gather details about any entities that would enhance your description of {{ entity.name }}'s appearance.

{% endif %}
Your response must be valid XML following the format above, containing a single <appearance> element with <title> and <detail> tags.`;

export default createPrompt(meta, prompt);
