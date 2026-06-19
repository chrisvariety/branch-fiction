import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  character: v.object({
    name: v.string(),
    label: v.optional(v.string()),
    arcs: v.array(
      v.object({
        friendlyId: v.string(),
        content: v.string()
      })
    )
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
  name: 'Character Portrait',
  input: InputSchema
};

const prompt = `You are creating a visual description to generate a reference portrait of {{ character.name }}, used as the source image for an AI avatar of this character.

The character may have multiple appearance descriptions from different points in the story:

<character name="{{ character.name }}">
  {% for arc in character.arcs %}
  <arc id="{{ arc.friendlyId }}">
    {{ arc.content }}
  </arc>
  {% endfor %}
</character>

{% if relatedEntities and relatedEntities.length > 0 %}
<related_entities>
The following items/entities are related to this character and may need visual details looked up:

{% for entity in relatedEntities %}
<entity id="{{ entity.friendlyId }}" type="{{ entity.type }}"{% if entity.phrasesUsed %} phrases="{{ entity.phrasesUsed }}"{% endif %}>{{ entity.summary }}</entity>
{% endfor %}
</related_entities>

You have access to the following tool:
* \`lookup_related_entity_appearance({id: string})\`: Retrieves detailed visual information about a related entity using its ID from the list above.

Use the lookup_related_entity_appearance tool to get visual details for any items that would be visible in a front-facing portrait (head, face, neck, shoulders, upper chest). This includes items worn on the head, face, neck, or upper body, as well as tattoos, scars, or other markings on visible skin. Skip items that wouldn't be visible. You can batch lookups for efficiency.

{% endif %}
## Selecting the right version

When the character has multiple versions, choose the one where they appear most capable, healthy, and in their prime — the way you would picture them as a clear, front-facing reference photo. Avoid versions showing incapacitation, severe injury, or disguise, unless that state defines the character throughout the story. If versions seem equal, prefer the one with the most distinctive, recognizable visual markers.

## Creating the description

Provide an enhanced visual description suitable for a front-facing portrait photo, focused on what is visible from roughly the chest up:
1. Face shape, skin, and expression
2. Hair (color, length, style) and any facial hair
3. Distinguishing features (scars, eye color, notable markings)
4. Clothing visible at the shoulders/upper chest, and any head/neck items
5. Visual details of any looked-up items that would be visible in the portrait

Keep it concrete and visual. Do not invent a background or setting — the portrait will be on a plain backdrop.

Output your response in this exact format:
<portrait>
  <arc_id>[chosen arc id]</arc_id>
  <description>[Enhanced visual description for {{ character.name }}.]</description>
</portrait>`;

export default createPrompt(meta, prompt);
