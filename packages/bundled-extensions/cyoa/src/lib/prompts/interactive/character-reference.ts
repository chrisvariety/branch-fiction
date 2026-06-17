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
  name: 'Character Reference',
  input: InputSchema
};

const prompt = `You are creating a visual description for generating a character headshot reference image for {{ character.name }}.

The character may have multiple appearance descriptions from different points in the story. Your task is to select the most representative version and enhance it with additional visual details.

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

Use the lookup_related_entity_appearance tool to get visual details for any items that would be visible in a headshot (head and shoulders). This includes items worn on the head, face, neck, or upper body, as well as tattoos, scars, or other markings on visible skin. Skip items that wouldn't be visible in a headshot. You can batch lookups for efficiency.

{% endif %}
## Selecting the Right Version

When the character has multiple appearance versions, choose the one where they appear most capable, active, or in their prime. Avoid versions showing total incapacitation, unconsciousness, or severe debilitation—unless that state is the character's defining trait throughout the story.

If versions seem equally viable, prefer the one with the most distinctive visual markers: specific scars, unique equipment, notable uniforms, or other details that make the character immediately recognizable.

## Creating the Description

Provide an enhanced visual description that:
1. Draws from your selected appearance version
2. Describes physical appearance (face, hair, distinguishing features)
3. Incorporates visual details of any looked-up items visible in a headshot

Output your response in this format:
<character>
  <arc_id>[chosen arc id]</arc_id>
  <description>Enhanced visual description for {{ character.name }}.</description>
</character>`;

export default createPrompt(meta, prompt);
