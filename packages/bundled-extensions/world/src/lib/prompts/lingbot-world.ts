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
1. **FOV + subject** — ALWAYS open with a third-person over-the-shoulder view following {{ character.name }}, with {{ character.name }} centered in frame. LingBot works best when the chosen character is the centered subject the camera trails from behind/over the shoulder. Describe {{ character.name }}'s concrete appearance (clothing, hair, distinctive features) from the description above.
   - **Honor what {{ character.name }} actually IS, and pose them accordingly.** Infer their nature from the description and choose the bearing that fits it: a winged creature or dragon is airborne — wings spread, in flight above the terrain, not walking the ground; a rider is mounted; a bird soars; a fish or sea creature swims; an ordinary person travels on foot. Never default to a generic "moves through" — name the specific mode (flying, soaring, riding, striding, swimming) that matches the body in the description.
2. **Object layers** — describe near (ground level), mid (focal elements), and far (backdrop) planes of {{ place.name }}.
3. **Camera framing** — keep {{ character.name }} centered, seen from behind/over the shoulder so the user can navigate the world ahead. Position-only language for the viewpoint.
4. **Atmosphere** — one closing phrase for palette, energy, and style.

## Critical rules
- Do NOT direct the camera to move (no "the camera pans", "we follow", "pushing forward") — the user controls all navigation. Ambient world motion and the subject's implied bearing are fine.
- The over-the-shoulder framing and {{ character.name }} centered are non-negotiable — never switch to first-person or place {{ character.name }} off to the side.
- The prompt must align with the seed image and not contradict itself.
- Stay under ~500 tokens (ideally far less). No proper nouns beyond the character and place names.
- Do not invent details that contradict the descriptions.

## Example of the target style (different character/place — match the FRAMING and structure, not the content)
The video presents a third-person over-the-shoulder view following a sword-slung rider in a white tunic and dark sash, hair tied in a high topknot, seated firmly on a brown horse whose long braided tail sways as it moves steadily through curling valley mist. Wildflower meadows of violet lupines and crimson poppies spread across the landscape between weathered boulders, while a hamlet of half-timbered cottages, stone watchtowers, and a moss-eaten ruined portal arch stands in the misted middle distance. Far ahead on a craggy peak, a many-spired castle with crimson pennants snapping from its towers grows clearer against a vast ringed gas giant and a pale crescent moon hanging in the peach-tinted twilight sky. Painterly fantasy storybook atmosphere.

Output ONLY this, nothing else:
<world_prompt>
[the base prompt]
</world_prompt>`;

export default createPrompt(meta, prompt);
