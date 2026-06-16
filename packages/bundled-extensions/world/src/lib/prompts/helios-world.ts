import * as v from 'valibot';

import { createPrompt, PromptMeta } from './index';

const AppearanceSchema = v.object({
  id: v.string(),
  title: v.string(),
  chapterRange: v.string(),
  content: v.string()
});

const InputSchema = v.object({
  character: v.object({
    name: v.string(),
    appearances: v.array(AppearanceSchema)
  }),
  place: v.object({
    name: v.string(),
    appearances: v.array(AppearanceSchema)
  })
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Helios World Prompt',
  input: InputSchema
};

const prompt = `You are writing the opening prompt for Helios, a real-time video generation model. This single prompt establishes a living scene that the user will then steer.

You are given {{ character.name }} and the place {{ place.name }}. {{ character.name }} has one or more self-contained appearance snapshots from a novel — the character looks different at different points in the story (different outfits, grooming, condition). Your job is to place {{ character.name }} within {{ place.name }} in the appearance that fits THAT place.

<character_appearances name="{{ character.name }}">
{% for a in character.appearances -%}
<appearance id="{{ a.id }}" title="{{ a.title }}" chapters="{{ a.chapterRange }}">
{{ a.content }}
</appearance>
{% endfor -%}
</character_appearances>

<place name="{{ place.name }}">
{% for a in place.appearances -%}
<snapshot id="{{ a.id }}" title="{{ a.title }}" chapters="{{ a.chapterRange }}">
{{ a.content }}
</snapshot>
{% endfor -%}
</place>

## Step 1 — choose the appearance that fits the place
{{ place.name }} is the scene anchor. From {{ character.name }}'s appearance options above, SELECT THE SINGLE ONE whose outfit, grooming, and physical state most plausibly belong at {{ place.name }} (e.g. a ballroom → the formal-gown appearance; a battlefield → the armored, battle-worn appearance; a bedroom at night → sleepwear). When the place snapshots and an appearance snapshot describe the same moment or setting, that is a strong match. Use ONLY the chosen appearance's details to describe {{ character.name }} — do NOT blend in clothing or features from the other appearance options.

## Step 2 — write the opening prompt
A strong opening prompt does the heavy lifting in a single pass. Cover all five, woven into flowing prose (not a bulleted list):
1. **Subject** — {{ character.name }}'s concrete physical characteristics (face, hair, build, distinctive features, clothing) drawn from the chosen appearance.
2. **Environment** — layer {{ place.name }} by depth: near, mid, and far. Use only details grounded in the place snapshots.
3. **Lighting** — describe how light actually falls on surfaces (e.g. "warm light catching the edge of her jaw"), not generic labels.
4. **Mood** — convey through posture and action, not abstract feeling words.
5. **Camera** — Helios works best when the subject faces the camera and the shot type is explicit. End the prompt with a concrete shot-type sentence (e.g. "Medium shot focused on {{ character.name }}, facing the camera." or "Close-up of {{ character.name }} looking toward the camera, slow push-in."). Always name the framing (close-up / medium shot / wide shot) and keep {{ character.name }} oriented toward the viewer.

## Rules
- Present tense. One coherent establishing shot — do NOT describe a sequence of events.
- {{ character.name }} must face the camera (front-facing or three-quarter), not turned away.
- Name the visual aesthetic once (e.g. "cinematic, painterly realism").
- Stay under ~500 tokens; tighter is better. No proper nouns beyond the character and place names.
- Do not invent details that contradict the chosen snapshots.

Output ONLY this, nothing else:
<selected_appearance_id>[the id of the appearance you chose]</selected_appearance_id>
<world_prompt>
[the opening prompt]
</world_prompt>`;

export default createPrompt(meta, prompt);
