import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
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
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Determine Entity Arc',
  input: InputSchema
};

const prompt = `You are an AI analyst tasked with determining if an entity has a significant "appearance arc" by examining its attributes chronologically throughout a novel. Your goal is to identify genuine transformations, not just the gradual reveal of information.

<entity_data>
Name: {{ name }}
Type: {{ type }}

{% for attribute in attributes %}
Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
{% endfor %}
</entity_data>

## The Core Analytical Task: Transformation vs. Revelation

Before evaluating the data, you must first determine the nature of the entity. Ask yourself: "Is this a single, unique item/person, or is it a category of things that can have multiple instances?" This distinction is crucial.

**Transformation (An Arc Exists 👍)**: This occurs when a single, unique entity undergoes a fundamental change, creating a clear "before" and "after."

*Example*: A specific sword named 'Glimmer' is a plain steel blade for the first half of the book, but after being quenched in dragon fire, it is permanently described as glowing with a faint blue light. This is a true arc.

**Revelation (No Arc exists 👎)**: This occurs when the entity is a category, and the narrative reveals different instances or examples of that category over time. Seeing different variations does not mean the category itself has changed.

*Example*: The entity is 'enchanted pendant.' In Chapter 1, we see a simple copper pendant on Character A. In Chapter 22, we see an ornate sapphire pendant on Character B. This is not an arc. You are simply learning more about the variety of enchanted pendants that exist in the world. The fundamental concept of 'enchanted pendant' has not changed.

## What Constitutes a Major Change

(This section defines what a transformation looks like if you've determined one might have occurred based on the "Core Analytical Task" above.)

An entity has an appearance arc if it undergoes **at least one major change**. Major changes include:

### For Characters:
- **Equipment & Attire**: Acquiring/losing significant armor, weapons, or magical items; major wardrobe changes signaling transformation; changes in characteristic accessories
- **Physical Transformations**: Permanent injuries, disfigurement, amputations, significant burns, magical curses affecting appearance, death/resurrection, rapid aging, shape-shifting
- **Bodily Modifications**: New tattoos, brands, magical marks; drastic hair changes; major weight changes; prosthetics
- **Status Markers**: Visible rank changes, ritual scarification, enslavement/imprisonment marks

### For Locations/Objects/Creatures:
- **Structural Changes**: Major construction/destruction, significant battle damage, magical alterations, environmental changes
- **Physical Alterations**: Reforging, corruption/purification, significant damage/degradation, enhancement/diminishment of magical properties affecting appearance
- **Transformations**: Evolution, metamorphosis, permanent injuries, magical alterations, significant aging/growth
- **Environmental Changes**: Major changes to surroundings altering presentation, permanent lighting changes, permanent seasonal/cyclical changes

## What to IGNORE (Not Major Changes)

Do NOT count these as major changes:
- **Temporary conditions**: dirt, blood, sweat, weather effects, minor injuries, temporary emotional states, exhaustion
- **Minor variations**: daily outfit changes within same style, different hairstyles, minor accessory swaps
- **Normal maintenance**: wear and tear, minor repairs, temporary decorations

## Task

First, analyze the <entity_data> to determine if the entity refers to a single, unique object/person or a category of objects/persons seen on multiple people or in multiple instances.

Based on that analysis, apply the rules to determine if a true transformation occurs. Remember, describing different examples of a category is revelation, not transformation.

Provide your conclusion using exactly one of these formats:
<has_arc>true</has_arc>
<has_arc>false</has_arc>

Use \`true\` only if a single entity undergoes a fundamental visual transformation. Use \`false\` if the entity's appearance is stable, or if the data merely reveals variations within a category.`;

export default createPrompt(meta, prompt);
