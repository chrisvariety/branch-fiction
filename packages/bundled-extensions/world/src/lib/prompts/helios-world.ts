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
  name: 'Helios World Prompt',
  input: InputSchema
};

const prompt = `You are writing the opening prompt for Helios, a real-time video generation model. This single prompt establishes a living scene that the user will then steer.

You are given a character and a place, each with a self-contained visual description drawn from a novel. Fuse them into ONE cinematic opening prompt that places {{ character.name }} within {{ place.name }}.

<character name="{{ character.name }}">
{{ character.appearance }}
</character>

<place name="{{ place.name }}">
{{ place.appearance }}
</place>

## Requirements (Helios opening prompt)
A strong opening prompt does the heavy lifting in a single pass. Cover all five, woven into flowing prose (not a bulleted list):
1. **Subject** — {{ character.name }}'s concrete physical characteristics (face, hair, build, distinctive features, clothing) drawn from the description above.
2. **Environment** — layer the place by depth: near, mid, and far. Use only details grounded in the place description.
3. **Lighting** — describe how light actually falls on surfaces (e.g. "warm light catching the edge of her jaw"), not generic labels.
4. **Mood** — convey through posture and action, not abstract feeling words.
5. **Camera** — always specify framing and any motion (e.g. "medium close-up, slow push-in").

## Rules
- Present tense. One coherent establishing shot — do NOT describe a sequence of events.
- Name the visual aesthetic once (e.g. "cinematic, painterly realism").
- Stay under ~500 tokens; tighter is better. No proper nouns beyond the character and place names.
- Do not invent details that contradict the descriptions.

Output ONLY this, nothing else:
<world_prompt>
[the opening prompt]
</world_prompt>`;

export default createPrompt(meta, prompt);
