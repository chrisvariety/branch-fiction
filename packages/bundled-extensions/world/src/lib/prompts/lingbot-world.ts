import * as v from 'valibot';

import { createPrompt, PromptMeta } from './index';

const InputSchema = v.object({
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
  name: 'LingBot World Prompt',
  input: InputSchema
};

const prompt = `You are writing the base prompt for LingBot, a real-time interactive world model the user navigates with movement and look controls. The base prompt describes the STATIC world; the user supplies all motion.

You are given a character and a place, each with a self-contained visual description from a novel, plus a seed image will be generated to match this prompt. Fuse them into ONE base prompt describing {{ place.name }} as a navigable world with {{ character.name }} present.

<character name="{{ character.name }}">
{{ character.appearance }}
</character>

<place name="{{ place.name }}">
{{ place.appearance }}
</place>

## Requirements (LingBot base prompt, 2-4 sentences)
1. **FOV + subject** — open with the viewpoint and primary subject (third-person view of {{ character.name }}, or first-person within {{ place.name }}).
2. **Object layers** — describe near (ground level), mid (focal elements), and far (backdrop) planes of {{ place.name }}.
3. **Camera framing** — position-only language describing how the subject sits in frame. NO motion.
4. **Atmosphere** — one closing phrase for palette, energy, and style.

## Critical rules
- ABSOLUTELY NO motion verbs (no "walking", "the camera pans", "galloping", "moving toward"). Describe the world statically — the user controls all movement.
- Describe a world, not a fixed path: say "{{ character.name }} on the open flagstones, a corridor leading off to one side", not "{{ character.name }} walking down the corridor".
- The prompt must align with the seed image and not contradict itself.
- Stay under ~500 tokens (ideally far less). No proper nouns beyond the character and place names.
- Do not invent details that contradict the descriptions.

Output ONLY this, nothing else:
<world_prompt>
[the base prompt]
</world_prompt>`;

export default createPrompt(meta, prompt);
