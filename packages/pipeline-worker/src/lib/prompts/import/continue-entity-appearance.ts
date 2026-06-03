import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
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
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Continue Entity Appearance',
  input: InputSchema
};

const prompt = `You are a Visual Continuity Engine for a world-building-to-image pipeline. Your task is to analyze raw, noisy text extractions containing physical descriptions of world elements (locations, items, organizations, creatures, artifacts, concepts) and output a clean, structured list of distinctive visual attributes for each entity.

Here is the entity data to analyze:

<entity_data>
{% for entity in entities %}
  <entity id="{{ entity.friendlyId }}" name="{{ entity.name }}" type="{{ entity.type }}">
    {% for attribute in entity.attributes %}
      Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
    {% endfor %}
  </entity>
{% endfor %}
</entity_data>

Your goal is to identify "distinctive" visual traits - those that would be essential for an artist or visual effects designer to accurately represent each entity. Focus on three main categories:

**Core Visual Features**: Primary appearance elements like color, shape, size, material, texture, architectural features, composition (be precise - resolve vague terms like "dark material" to specific descriptions like "black volcanic glass" or "weathered iron" when the text provides supporting detail)

**Distinctive Marks**: Unique identifying features like engravings, damage patterns, symbols, distinctive patterns, unique characteristics that set this entity apart from similar entities

**Consistent Elements**: Recurring visual characteristics mentioned multiple times, default states, or typical appearance details that remain constant

Follow these processing rules:

1. **Use Exact Entity IDs**: You MUST use the exact id from the <entity_data> id attribute for each entity in your output. Do not alter or modify the id in any way

2. **Ignore Situational Data**: Discard temporary states like current weather conditions affecting the entity, one-time visitors, momentary damage, or transient events

3. **Resolve Ambiguity**: When multiple descriptions exist for the same feature, prioritize the most detailed and specific version over shorthand references

4. **Consolidate Information**: Combine related descriptions into single, comprehensive attributes. If one mention says "engraved with runes" and another specifies "engraved with protective runes in ancient script," use the more specific version

5. **Require Evidence**: Only include attributes that have clear textual support in the provided data

6. **Maintain Entity Type Context**: Consider the entity type when determining what constitutes a distinctive visual feature. For locations, focus on architecture and landscape; for items, focus on form and decoration; for organizations, focus on visual identifiers like symbols or uniforms

Before producing the output, work through each entity:
1. List all physical/visual descriptions found
2. Categorize each description (Core Visual Features / Distinctive Marks / Consistent Elements / Situational)
3. Identify which descriptions to keep vs. discard based on the rules
4. Consolidate related descriptions
5. Note the supporting evidence for each final attribute

Provide your final analysis in this exact XML format:

<entities>
  <entity id="[Entity ID from entity_data]">
    <attribute category="[Core Visual Features/Distinctive Marks/Consistent Elements]" name="[Attribute Name]">
      <value>[Attribute Value]</value>
      <evidence>[Supporting quote and brief justification]</evidence>
    </attribute>
  </entity>
</entities>

Each \`<attribute>\` element should contain:
- **category** (attribute): One of the three main categories listed above
- **name** (attribute): The type of visual feature (e.g., "Material", "Color Scheme", "Architectural Style", "Symbol Design", "Shape")
- **value** (child element): The specific description of that feature
- **evidence** (child element): A relevant quote from the entity data plus a brief explanation of why this attribute was selected and how any ambiguity was resolved

Output only distinctive, permanent, and well-supported visual characteristics that would be essential for visual representation of each entity.`;

export default createPrompt(meta, prompt);
