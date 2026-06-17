import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  candidates: v.array(
    v.object({
      detectionNum: v.string(),
      area: v.number()
    })
  ),
  entity: v.object({
    name: v.string(),
    description: v.nullable(v.string())
  }),
  context: v.picklist(['body', 'head'])
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Pick Best Point Area',
  input: InputSchema
};

const prompt = `{% if context == 'head' %}I have {{ candidates.length }} different detected heads/faces and need to identify which one belongs to the character below.
{% else %}I have {{ candidates.length }} different detected regions that were matched to the character below.
{% endif %}
<entity>
  <name>{{ entity.name }}</name>
  {% if entity.description %}<description>{{ entity.description }}</description>{% endif %}

</entity>

<candidates>
{% for candidate in candidates %}
  <candidate number="{{ loop.index }}">
    <detection_id>{{ candidate.detectionNum }}</detection_id>
    <area>{{ candidate.area }}px²</area>
  </candidate>
{% endfor %}
</candidates>

<images>
I will show you {{ candidates.length + 1 }} images in this order:
  <image position="1" type="reference">
    Reference image {% if context == 'head' %}showing the full character{% endif %} "{{ entity.name }}"
  </image>
{% for candidate in candidates %}
  <image position="{{ loop.index + 1 }}" type="candidate" candidate_number="{{ loop.index }}" />
{% endfor %}
</images>

Task: Identify which candidate best matches "{{ entity.name }}".

{% if context == 'head' %}
Consider:
- Facial features and head shape matching the reference image
- Color, texture, and distinctive characteristics
- Consistency with the character description
{% else %}
Consider:
- Visual similarity to the reference image
- Whether it shows a single coherent entity vs merged/overlapping entities
- Quality and completeness of the detection
{% endif %}

Respond with ONLY the candidate number (1-{{ candidates.length }}), nothing else.`;

export default createPrompt(meta, prompt);
