import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  type: v.picklist(['CHARACTER_HORIZONTAL', 'CHARACTER_VERTICAL']),
  place: v.object({
    name: v.string(),
    description: v.nullish(v.string()),
    attributes: v.array(v.string())
  }),
  dynamics: v.string()
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Character Interactive',
  input: InputSchema
};

const prompt = `Create an adventurous scene where these characters are positioned naturally within an environment inspired by the following location. The composition should feel like the beginning of an epic journey, with characters poised for discovery or action.

<location>
  <name>{{ place.name }}</name>
  {% if place.description %}
    <description>{{ place.description }}</description>
  {% endif %}
  <attributes>
    {% for attribute in place.attributes %}
      {{ attribute }}
    {% endfor %}
  </attributes>
</location>

<character_arrangement>
{{ dynamics }}
</character_arrangement>

Instructions for composing the scene:

1. Position characters according to the spatial arrangement guidance provided above. Follow the positioning, orientation, and relationship dynamics described (e.g., if characters are described as facing each other, staring, holding hands, or in specific locations like "foreground left" or "background right").

2. Ensure characters face toward the viewer or are angled to show their faces clearly—never with their backs fully turned.

{% if type == 'CHARACTER_VERTICAL' %}
3. Incorporate vertical elements like stone steps, balconies, elevated platforms, or terraced levels to create depth and place characters at different heights, giving the scene dynamic dimensionality.

4. Match the lighting, atmosphere, and aesthetic of the location so the characters feel seamlessly integrated into their world rather than merely placed within it.

5. Ensure the background remains focused on the environment itself—no additional people should appear beyond the provided characters.
{% else %}
3. Match the lighting, atmosphere, and aesthetic of the location so the characters feel seamlessly integrated into their world rather than merely placed within it.

4. Ensure the background remains focused on the environment itself—no additional people should appear beyond the provided characters.
{% endif %}`;

export default createPrompt(meta, prompt);
