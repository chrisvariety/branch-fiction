import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  firstEntity: v.object({
    friendlyId: v.string(),
    name: v.string(),
    type: v.string(),
    attributes: v.array(
      v.object({
        chapterIdx: v.number(),
        category: v.string(),
        name: v.string(),
        value: v.string(),
        evidence: v.string()
      })
    )
  }),
  entities: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      type: v.string(),
      attributes: v.array(
        v.object({
          chapterIdx: v.number(),
          category: v.string(),
          name: v.string(),
          value: v.string(),
          evidence: v.string()
        })
      )
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
  name: 'Extract Entity Appearance Arc',
  input: InputSchema
};

const prompt = `{% if entities.length > 1 %}
You are a Lead Environment Artist and World-Building Designer. Your task is to distill collections of raw entity attributes, gathered chronologically from a novel, into "appearance arcs" that track how each entity's visual appearance evolves throughout the story.

The entities are related to each other and form a hierarchy. Analyze and create appearance arcs for each entity separately.

<entity_data>
  {% for entity in entities %}
    <entity id="{{ entity.friendlyId }}" name="{{ entity.name }}" type="{{ entity.type }}">
      {% for attribute in entity.attributes %}
        Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
      {% endfor %}
    </entity>
  {% endfor %}
</entity_data>
{% else %}
You are a Lead Environment Artist and World-Building Designer. Your task is to distill a collection of raw entity attributes, gathered chronologically from a novel, into an "appearance arc" that tracks how the entity's visual appearance evolves throughout the story.

<entity_data>
ID: {{ firstEntity.friendlyId }}
Name: {{ firstEntity.name }}
Type: {{ firstEntity.type }}

{% for attribute in firstEntity.attributes %}
Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
{% endfor %}
</entity_data>
{% endif %}

{% if relatedEntities and relatedEntities.length > 0 %}
<related_entities>
{% if entities.length > 1 %}
The following entities are related to the entities being described and may provide valuable context for creating more cohesive visual descriptions.
{% else %}
The following entities are related to {{ firstEntity.name }} and may provide valuable context for creating a more cohesive visual description.
{% endif %}

{% for entity in relatedEntities %}
<entity id="{{ entity.friendlyId }}" type="{{ entity.type }}"{% if entity.phrasesUsed %} phrases="{{ entity.phrasesUsed }}"{% endif %}>{{ entity.summary }}</entity>
{% endfor %}
</related_entities>

You have access to the following tool:
* \`lookup_related_entity({id: string})\`: Retrieves detailed information about a related entity using its ID from the list above.

{% if entities.length > 1 %}
**When to Use the Tool**: After reviewing the entity_data and related_entities, use \`lookup_related_entity\` to gather additional visual details about any related entities that directly impact the appearance or context of the entities you're describing. For example:
- If an entity is a location that contains specific architectural elements or decorative items, look up those items to learn their precise visual details
- If an entity is an object associated with a specific character or organization, look up that entity to understand visual motifs, colors, or insignia that should be reflected
- If an entity is part of a larger structure or system, look up related entities to ensure visual consistency and coherence
- If an entity has adjacent or nearby entities that influence its visual presentation, look them up for contextual details
{% else %}
**When to Use the Tool**: After reviewing the entity_data and related_entities, use \`lookup_related_entity\` to gather additional visual details about any related entities that directly impact {{ firstEntity.name }}'s appearance or context. For example:
- If {{ firstEntity.name }} is a location that contains specific architectural elements or decorative items, look up those items to learn their precise visual details
- If {{ firstEntity.name }} is an object associated with a specific character or organization, look up that entity to understand visual motifs, colors, or insignia that should be reflected
- If {{ firstEntity.name }} is part of a larger structure or system, look up related entities to ensure visual consistency and coherence
- If {{ firstEntity.name }} has adjacent or nearby entities that influence its visual presentation, look them up for contextual details
{% endif %}

**When NOT to Use the Tool**: Skip entities that are:
- Abstract concepts or relationships that don't have visual manifestations
- Generic or non-specific references without distinct visual characteristics
- Characters who don't contribute visual elements to the entity's description
- Entities mentioned only in passing without direct visual connection

Use the tool strategically to enrich your visual brief with accurate, specific details that make the entity description more vivid and contextually coherent.
{% endif %}

## Appearance Arc Concept

Entities in novels can undergo visual transformations throughout the narrative. Your task is to identify and document distinct "appearance phases" that span the narrative. Each phase represents a visually stable period, bounded by **major changes** in the entity's appearance.

**Important:** If an entity does NOT meaningfully transform (it remains visually consistent throughout the story), give it only ONE appearance entry. Not every entity needs multiple phases.

### What Constitutes a "Major Change"

Create a new appearance entry when ANY of the following occur:

**Structural Changes (for Locations/Architecture):**
- Major construction or destruction (e.g., "eastern tower collapses," "new wing added," "walls rebuilt")
- Significant battle damage or siege effects that permanently alter the structure
- Magical alterations (e.g., "barrier erected around perimeter," "castle consumed by corrupting vines")
- Environmental changes (e.g., "fortress sinks partially into swamp," "building encased in ice")

**Physical Alterations (for Objects/Items):**
- Reforging, repair, or significant modification (e.g., "sword reforged with new metal," "crown jewels replaced")
- Corruption or purification (e.g., "blade darkens and gains runes," "artifact cleansed of taint")
- Damage or degradation (e.g., "shield split in half," "gemstone cracked")
- Enhancement or diminishment of magical properties that affect appearance (e.g., "begins glowing," "loses its shimmer")

**Transformations (for Creatures/Beings):**
- Evolution or metamorphosis (e.g., "dragon molts into new color," "creature transforms to adult form")
- Permanent injuries or disfigurement (e.g., "loses wing," "eye scarred shut")
- Magical alterations (e.g., "cursed into stone form," "blessed with golden scales")
- Significant aging or growth that changes appearance

**Environmental/Contextual Changes:**
- Major changes to surroundings that alter the entity's presentation (e.g., "forest around ruins is cleared," "lake drains revealing submerged ruins")
- Permanent lighting changes (e.g., "eternal flames lit," "magical darkness descends")
- Seasonal or cyclical changes that are permanent/semi-permanent (e.g., "perpetual autumn after the curse")

### What to IGNORE (Not Major Changes)

**Temporary Conditions:**
- Temporary Weather effects: covered in snow, soaked from rain, frost-covered unless it's the permanent state
- Temporary damage from recent battles that will be repaired
- Transient decorations for events or ceremonies
- Visiting characters or temporary occupants
- Situational lighting (sunset, specific time of day) unless it's the permanent state

**Minor Variations:**
- Normal wear and tear that doesn't significantly change appearance
- Minor repairs or maintenance that restore to original state
- Temporary magical effects that fade quickly
- Cosmetic changes that don't alter the fundamental visual identity

### Output Format

{% if entities.length > 1 %}
Create an XML document with the following structure, grouping appearance arcs by entity:

\`\`\`xml
<entity_arcs>
  <entity id="[Entity id from entity_data]">
    <appearances>
      <appearance>
        <chapters>X-Y</chapters>
        <title>[Narratively descriptive phrase]</title>
        <detail>[Complete standalone visual description in flowing prose]</detail>
      </appearance>
      <appearance>
        <chapters>Z-W</chapters>
        <title>[Narratively descriptive phrase]</title>
        <detail>[Complete standalone visual description in flowing prose]</detail>
      </appearance>
    </appearances>
  </entity>
  <entity id="[Entity id from entity_data]">
    <appearances>
      <appearance>
        <chapters>A-B</chapters>
        <title>[Narratively descriptive phrase]</title>
        <detail>[Complete standalone visual description in flowing prose]</detail>
      </appearance>
    </appearances>
  </entity>
</entity_arcs>
\`\`\`

Each <entity> element should have an id attribute matching the entity's id from entity_data. Each <appearance> element should contain:
1. **<chapters>**: Chapter range (e.g., "1-12", "15", "20+")
2. **<title>**: A narratively descriptive few words capturing the essence of this appearance (e.g., "The pristine observatory", "Battle-scarred ruins", "The corrupted fortress")
3. **<detail>**: A complete visual description written as flowing prose that integrates:
   - Overall visual identity and impression
   - Overall size, shape, and structural design
   - Materials and surface qualities
   - Color palette and light sources
   - Decorative elements, state of repair, and visual mood

   **For subsequent appearances**: Explicitly note what has changed from the previous appearance. Use phrases like "now features", "has been damaged", "was once X but is now Y", etc. to clearly indicate transformations and build upon the previous description
{% else %}
Create an XML document with the following structure:

\`\`\`xml
<appearances>
  <appearance>
    <chapters>X-Y</chapters>
    <title>[Narratively descriptive phrase]</title>
    <detail>[Complete standalone visual description in flowing prose]</detail>
  </appearance>
  <appearance>
    <chapters>Z-W</chapters>
    <title>[Narratively descriptive phrase]</title>
    <detail>[Complete standalone visual description in flowing prose]</detail>
  </appearance>
</appearances>
\`\`\`

Each <appearance> element should contain:
1. **<chapters>**: Chapter range (e.g., "1-12", "15", "20+")
2. **<title>**: A narratively descriptive few words capturing the essence of this appearance (e.g., "The pristine observatory", "Battle-scarred ruins", "The corrupted fortress")
3. **<detail>**: A complete visual description written as flowing prose that integrates:
   - Overall visual identity and impression
   - Overall size, shape, and structural design
   - Materials and surface qualities
   - Color palette and light sources
   - Decorative elements, state of repair, and visual mood

   **For subsequent appearances**: Explicitly note what has changed from the previous appearance. Use phrases like "now features", "has been damaged", "was once X but is now Y", etc. to clearly indicate transformations and build upon the previous description
{% endif %}

### Description Guidelines

- Write in flowing, vivid prose using concrete language to describe scale, material, light, color, and condition
- Focus exclusively on what a camera would see
- For in-world terms (e.g., 'starcrystal', 'wards', 'essence-forged'), you must provide a visual definition in parentheses immediately after the term first appears. For example: "...the walls are lined with wardstones (fist-sized crystals that pulse with protective blue light) at regular intervals."
- Be specific with colors (e.g., "storm-gray," "emerald green," not just "blue" or "green")
- For appearances after the first one, clearly note what has changed to show the entity's evolution

### Example Output

{% if entities.length > 1 %}
<entity_arcs>
<entity id="celestial_observatory">
<appearances>
{% else %}
<appearances>
{% endif %}
<appearance>
<chapters>1-23</chapters>
<title>The celestial observatory</title>
<detail>
A majestic floating structure hovers above the clouds, the size of a small city appearing as a cluster of sky-islands. Built by the Astral Architects in an age long past, it resembles a crown of gleaming, needle-thin spires and iridescent domes connected by elegant bridges of pure solidified light. The entire structure is built from starcrystal (a polished, opalescent material that shifts color with the light and resonates with celestial energy) inlaid with intricate veins of gold and silver forming complex patterns. Railings and trim are crafted from smooth, white, magically-grown wood cultivated by the Order of Verdant Keepers. Four massive celestial anchors—towering obelisks of black stone etched with slowly-rotating constellation patterns—stand positioned at the cardinal points, anchoring the structure to reality.

The massive central dome houses the Grand Orrery, a colossal, perpetually moving astronomical device made of brass and captured starlight, while smaller private towers spiral outward for individual scholars. Open-air platforms contain magically-sustained verdant gardens bursting with greenery and flowers, tended by Keeper Sylara. The starcrystal surfaces are impossibly smooth and seamless, while the light-bridges feel like walking through warm, solidified air with a soft, ethereal hum. The color palette features iridescent whites, pale blues, and soft lavenders from the crystal, accented by gleaming polished gold and silver, with vibrant splashes of green and floral colors from the gardens.

The observatory glows from within, illuminated by captured ambient starlight that causes the crystal to emit a soft, constant radiance. During the day, sunlight refracts through the crystal into shifting rainbows. Magical lanterns provide gentle, diffuse light throughout, creating a shadowless environment. Intricate celestial charts and constellations are etched directly into the crystalline walls and floors, glowing faintly. Graceful statues depicting ancient Star-Seers and scholarly figures stand throughout the gardens, and glowing runes pulse slowly along archways and doorways. The entire structure is pristine and timeless, maintained by its own magic with no signs of age, wear, or decay. The visual mood is serene and awe-inspiring, broken only by the gentle hum of the floating island and the soft chime of the Grand Orrery—a place of immense, ancient knowledge and peaceful isolation.
</detail>
</appearance>

<appearance>
<chapters>24-35</chapters>
<title>The broken sanctuary</title>
<detail>
The once-majestic floating structure still hovers above the clouds but now appears diminished and damaged, with visible gaps where sections have fallen away after the Void Assault. The crown of gleaming spires is now jagged and incomplete—three eastern towers have collapsed entirely under bombardment from the Shadow Fleet's siege engines, leaving broken stumps with sharp fractured edges of crystal jutting into the sky. The elegant light-bridges that once connected platforms seamlessly now flicker intermittently, pulsing weakly and appearing unstable as they shift between solid and ethereal states. The massive central dome, previously pristine, is now heavily cracked with a massive fissure running from apex to base where Warlock Kael's spell struck. Inside, the Grand Orrery continues its perpetual motion, but several celestial bodies have fallen and lie shattered on the floor. The western gardens that once burst with greenery and flowers are destroyed, their platforms tilting at dangerous angles, charred and lifeless—Keeper Sylara perished defending them.

The starcrystal that was once impossibly smooth and seamless is now fractured in many places, with chunks missing and edges sharp and dangerous. The intricate veins of gold and silver inlay have been torn away in places or tarnished from polished gleam to dull gray. The smooth, white magical wood railings cultivated by the Order of Verdant Keepers are splintered and burned. Of the four massive celestial anchors that once stood at the cardinal points, only three remain upright—the southern anchor has toppled completely after being severed by the Voidblade, causing the entire structure to list slightly southward. Surfaces that were once smooth now show cracks and rough scorch marks from corrupted magical fire.

The color palette has shifted dramatically from its former beauty. The iridescent whites have dulled to cloudy gray in damaged sections. Where crystal remains intact, it still shows pale blues and lavenders, but much is now dark and lifeless. The polished gold and silver appear tarnished and worn. The vibrant greens and florals of the gardens are gone entirely, replaced by charred, empty platforms. The captured ambient starlight that once provided soft, constant illumination now flickers weakly, leaving many areas in darkness. Where sunlight once refracted into shifting rainbows, it now passes through cracks creating harsh, jagged shadows throughout the structure. The intricate celestial charts etched into walls and floors are destroyed or obscured by damage. The graceful statues depicting ancient Star-Seers lie toppled and shattered, and the glowing runes that pulsed steadily now sputter irregularly—some sections completely dark. The pristine, timeless structure maintained by its own magic now shows battle scars and accumulated damage. The serene, awe-inspiring mood has shifted to melancholic and ominous. The gentle hum has become an irregular grinding sound, and the soft chimes of the Grand Orrery have turned discordant. It feels like a dying place where ancient knowledge slips away into darkness.
</detail>
</appearance>
{% if entities.length > 1 %}
</appearances>
</entity>
</entity_arcs>
{% else %}
</appearances>
{% endif %}

{% if relatedEntities and relatedEntities.length > 0 %}
{% if entities.length > 1 %}
**Workflow**: Before writing your final appearance arcs, review the related_entities list and use the \`lookup_related_entity\` tool to gather details about any entities that would enhance your descriptions of the entities' appearances across different phases.
{% else %}
**Workflow**: Before writing your final appearance arc, review the related_entities list and use the \`lookup_related_entity\` tool to gather details about any entities that would enhance your description of {{ firstEntity.name }}'s appearance across different phases.
{% endif %}

{% endif %}
{% if entities.length > 1 %}
Your response must be valid XML following the format above, containing an <entity_arcs> root element with <entity> children. Each <entity> should have an <appearances> element containing as many <appearance> elements as needed to capture all major visual changes for that entity throughout the novel.
{% else %}
Your response must be valid XML following the format above. Include as many <appearance> elements as needed to capture all major visual changes throughout the novel.
{% endif %}`;

export default createPrompt(meta, prompt);
