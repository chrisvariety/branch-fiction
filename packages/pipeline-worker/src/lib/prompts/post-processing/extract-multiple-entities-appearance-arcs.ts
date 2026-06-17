import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  entities: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      type: v.string(),
      description: v.optional(v.string()),
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
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Multiple Entities Appearance Arcs',
  input: InputSchema
};

const prompt = `You are a Lead Environment Artist and World-Building Designer. Your task is to process a batch of entities from a novel and produce visual appearance arcs that track how each entity looks throughout the story.

These entities include species, locations, recurring objects, and other elements that contribute to the world's visual identity.

<entities>
{% for entity in entities %}
  <entity id="{{ entity.friendlyId }}" name="{{ entity.name }}" type="{{ entity.type }}">
    {% for attribute in entity.attributes %}
      Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
    {% endfor %}
  </entity>
{% endfor %}
</entities>


## Your Task

For each entity, you must:

1. **Determine if the entity has an appearance arc** (transformation vs. revelation)
2. **Synthesize its scattered attributes into a cohesive visual portrait**—not a list of traits
3. **Write one or more appearance entries** accordingly

### Transformation vs. Revelation

Before writing appearances, determine the nature of each entity:

**Transformation (multiple appearances)**: A single, unique entity undergoes a fundamental visual change, creating a clear "before" and "after." Example: a named sword that is reforged, a fortress that is besieged and partially destroyed, a creature that evolves.

**Revelation (single appearance)**: The narrative gradually reveals more details about an entity, or shows different instances of a category. Seeing different examples of golem sentries across chapters is not an arc—you're just learning more about what golems look like. Compile all revelations into one comprehensive appearance entry.

Most entities will have **one appearance entry**. Only create multiple entries when a genuine transformation occurs.

### What Constitutes a Transformation

Create a new appearance entry only when:
- **Structural changes**: Major construction, destruction, battle damage, magical alterations
- **Physical alterations**: Reforging, corruption/purification, significant damage, magical property changes affecting appearance
- **Biological transformations**: Evolution, metamorphosis, permanent injury, significant aging/growth
- **Environmental shifts**: Permanent changes to surroundings that alter presentation

**Ignore**: Temporary conditions (weather, minor injuries, transient states), minor variations, normal wear and tear, gradual revelation of existing details across chapters.

### Output Format

Produce a valid XML document with this structure:

\`\`\`xml
<entity_arcs>
  <entity id="[friendlyId from input]">
    <appearances>
      <appearance>
        <chapters>X-Y</chapters>
        <title>[Short descriptive phrase]</title>
        <detail>[Visual description in flowing prose]</detail>
      </appearance>
    </appearances>
  </entity>
</entity_arcs>
\`\`\`

Each \`<appearance>\` element contains:
1. **\`<chapters>\`**: Chapter range (e.g., "1-45", "1-20", "25+")
2. **\`<title>\`**: A brief, narratively descriptive phrase (e.g., "Immortal predators", "The shattered blade", "Ruins before the flood")
3. **\`<detail>\`**: A visual description in flowing prose. Aim for **1-2 paragraphs** that capture:
   - Overall visual impression and defining features
   - Key physical characteristics (size, shape, color, materials)
   - Distinctive visual details that make the entity recognizable
   - For subsequent appearances: explicitly note what changed using phrases like "now features", "has been damaged", "was once X but is now Y"

### Description Guidelines

- Write in flowing, vivid prose using concrete visual language
- Focus on what a camera would see—no internal states, motivations, or lore unless it manifests visually
- For in-world terms, provide a brief visual definition in parentheses on first use (e.g., "wardstones (fist-sized crystals pulsing with blue light)")
- Be specific with colors (e.g., "ash-gray", "deep crimson", not just "gray" or "red")

### Example

For a golem-like species with attributes describing stone bodies, glowing runes, siege-weapon strength, and various sizes across many chapters but no fundamental visual change—this is revelation, not transformation:

\`\`\`xml
<entity_arcs>
  <entity id="ironbound">
    <appearances>
      <appearance>
        <chapters>1-38</chapters>
        <title>Living siege engines</title>
        <detail>
Towering humanoid constructs standing eight to twelve feet tall, built from interlocking plates of dark, rough-hewn iron fused to a core of volcanic basalt. Their surfaces are pitted and weathered to a mottled charcoal-black, streaked with rust-orange where rain has found the seams. Runescript (thin channels carved into the metal and filled with molten hearthstone, glowing a dull ember-orange) traces angular patterns across their chest plates and forearms, pulsing brighter when they move. Their heads are featureless slabs with a single horizontal slit that emits a steady furnace-red glow, and their hands end in four blunt digits capable of crushing stone. They move with a grinding, deliberate cadence—each step reverberating through the ground—and trail faint wisps of heat shimmer from their joints. Older constructs show thicker layers of oxidation and deeper scoring across their plates, while younger ones gleam with a darker, oilier sheen. In stillness they could be mistaken for brutalist statuary, but the low, rhythmic thrum emanating from their cores betrays the furnace burning within.
        </detail>
      </appearance>
    </appearances>
  </entity>
</entity_arcs>
\`\`\`

Process every entity in the batch. Your response must be a single valid XML document with an \`<entity_arcs>\` root element containing one \`<entity>\` child per input entity, each with its own \`<appearances>\` block.`;

export default createPrompt(meta, prompt);
