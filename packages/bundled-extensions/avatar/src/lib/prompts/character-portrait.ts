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
  })
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

## Selecting the right version

When the character has multiple versions, choose the one where they appear most capable, healthy, and in their prime — the way you would picture them as a clear, front-facing reference photo. Avoid versions showing incapacitation, severe injury, or disguise, unless that state defines the character throughout the story. If versions seem equal, prefer the one with the most distinctive, recognizable visual markers.

## Creating the description

Provide an enhanced visual description suitable for a front-facing portrait photo, focused on what is visible from roughly the chest up:
1. Face shape, skin, and expression
2. Hair (color, length, style) and any facial hair
3. Distinguishing features (scars, eye color, notable markings)
4. Clothing visible at the shoulders/upper chest, and any head/neck items

Keep it concrete and visual. Do not invent a background or setting — the portrait will be on a plain backdrop.

Output your response in this exact format:
<portrait>
  <arc_id>[chosen arc id]</arc_id>
  <description>[Enhanced visual description for {{ character.name }}.]</description>
</portrait>`;

export default createPrompt(meta, prompt);
