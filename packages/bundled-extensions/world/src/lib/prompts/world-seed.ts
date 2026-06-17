import * as v from 'valibot';

import { createPrompt, PromptMeta } from './index';

const InputSchema = v.object({
  model: v.picklist(['lingbot', 'helios']),
  artStyle: v.string(),
  worldPrompt: v.string(),
  character: v.object({
    name: v.string(),
    appearance: v.string()
  }),
  place: v.object({
    name: v.string(),
    appearance: v.string()
  })
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'World Seed Image Prompt',
  input: InputSchema
};

const prompt = `A cinematic establishing scene: {{ character.name }} within {{ place.name }}.

Scene composition (this is the shot to render — match where {{ character.name }} is positioned in the world and how the scene is framed; the detailed descriptions below are reference for appearance, not a license to contradict this composition):
{{ worldPrompt }}

{{ place.name }}: {{ place.appearance }}

{{ character.name }}: {{ character.appearance }}

Requirements:
{% if model == 'lingbot' -%}
- Third-person over-the-shoulder view following {{ character.name }}, with {{ character.name }} centered in frame and seen from behind, the world opening up ahead. Pose {{ character.name }} in the way that fits what they are, e.g. a winged creature or dragon airborne with wings spread, an ordinary person on foot, a sprite floating in the air, etc.
{% else -%}
- Establishing shot of {{ character.name }} present in the environment, {{ character.name }} facing the camera (front-facing or three-quarter).
{% endif -%}
- Rendered in a {{ artStyle }}.
- Do not include any text, labels, or names.`;

export default createPrompt(meta, prompt);
