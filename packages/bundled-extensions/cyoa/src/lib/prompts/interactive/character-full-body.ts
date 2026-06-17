import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  character: v.object({
    name: v.string(),
    segmentClass: v.string(),
    pronouns: v.nullish(v.string()),
    description: v.nullish(v.string())
  }),
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
  name: 'Character Full Body',
  input: InputSchema
};

const prompt = `You are a Character Analysis Specialist tasked with determining the appropriate pose and aspect ratio for a full-body reference image, and enhancing the character description with additional visual details from related entities.

Here is the character and their description:

<character name="{{ character.name }}" type="{{ character.segmentClass }}"{% if character.pronouns %} pronouns="{{ character.pronouns }}"{% endif %}>
  {% if character.description %}{{ character.description }}{% endif %}
</character>

{% if relatedEntities and relatedEntities.length > 0 %}
<related_entities>
The following entities are related to {{ character.name }} and may provide valuable context for understanding visual details mentioned in the description (e.g., specific weapons, armor types, magical items, creatures).

{% for entity in relatedEntities %}
<entity id="{{ entity.friendlyId }}" type="{{ entity.type }}"{% if entity.phrasesUsed %} phrases="{{ entity.phrasesUsed }}"{% endif %}>{{ entity.summary }}</entity>
{% endfor %}
</related_entities>

You have access to the following tool:
* \`lookup_related_entity_appearance({id: string})\`: Retrieves detailed visual information about a related entity using its ID from the list above.

**When to Use the Tool**: Use \`lookup_related_entity_appearance\` to gather additional visual details about related entities that appear in the reference image and are mentioned in {{ character.name }}'s description. For example:
- If {{ character.name }} is wearing or carrying a specific weapon, armor, or item mentioned in the description, look it up to get accurate visual details
- If {{ character.name }} has equipment, markings, or accessories with specific visual features, look them up

**When NOT to Use the Tool**: Skip entities that are:
- Not visible in the reference image
- Abstract concepts without visual representation
- Characters (focus on objects/items/creatures instead)
- Generic items without distinct visual characteristics
{% endif %}

---

## YOUR TASK

1. **Determine the appropriate pose and aspect ratio** for a full-body reference image based on the character type and reference image
2. **Enhance the description** by looking up related entities to add specific visual details for in-world items, equipment, or markings mentioned in the description

---

## OUTPUT FORMAT

Your output MUST be a \`<character>\` element containing \`<aspect_ratio>\`, \`<pose>\`, and \`<description>\` elements:

\`\`\`
<character>
  <aspect_ratio>3:4</aspect_ratio>
  <pose>standing with one hand resting on hip, weight shifted to back leg, head slightly tilted</pose>
  <description>Enhanced description here</description>
</character>
\`\`\`

**aspect_ratio**: Choose the best aspect ratio for a full-body image of this character:
- Use \`3:4\` or \`9:16\` for humanoid characters (humans, elves, vampires, etc.)
- Use \`1:1\` for non-humanoid characters (animals, creatures, objects, etc.)

**pose**: Suggest a natural, characteristic pose that fits the character's form and nature:
- **Humanoids**: standing poses with natural weight distribution, relaxed or confident stances, hands at sides or on hips
- **Quadrupeds**: standing on all fours, sitting alert, or in a natural resting position
- **Winged creatures**: perched with wings folded, or standing with wings partially spread
- **Serpentine creatures**: coiled or in an S-curve position
- **Aquatic creatures**: swimming pose or floating naturally
- Keep poses simple and static—avoid action poses or complex movements

**description**: The character description, enhanced with any additional visual details gathered from related entity lookups. NO personality traits, backstory, or narrative context.

---

## PROCESS

1. **Examine the reference image** of {{ character.name }}
2. **Determine aspect ratio and pose** based on character type and the reference image
{% if relatedEntities and relatedEntities.length > 0 %}
3. **Look up related entities** - if any items, equipment, or creatures from the related_entities list are visible in the image and mentioned in the description, use the \`lookup_related_entity_appearance\` tool to get accurate visual details
4. **Write the enhanced description** incorporating any additional visual details from related entity lookups
{% else %}
3. **Write the description** as provided
{% endif %}

Write your complete output now inside \`<character>\` tags:`;

export default createPrompt(meta, prompt);
