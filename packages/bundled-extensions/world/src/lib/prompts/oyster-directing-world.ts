import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

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
  name: 'HappyOyster Directing World Prompt',
  input: InputSchema
};

const prompt = `You are writing the opening prompt for HappyOyster Directing, a real-time world model the user steers by typing plain-English instructions while it runs. Your prompt stages the opening shot; the user directs everything after it. Think of yourself as writing the first page of a shooting script, not a still image caption.

Here are the character appearances:

<character_appearances name="{{ character.name }}">
{% for a in character.appearances -%}
<appearance id="{{ a.id }}" title="{{ a.title }}" chapters="{{ a.chapterRange }}">
{{ a.content }}
</appearance>
{% endfor -%}
</character_appearances>

Here is the place:

<place name="{{ place.name }}">
{% for a in place.appearances -%}
<snapshot id="{{ a.id }}" title="{{ a.title }}" chapters="{{ a.chapterRange }}">
{{ a.content }}
</snapshot>
{% endfor -%}
</place>

## STEP 1: Select the Appearance That Fits the Place

The place is your anchor. Read every appearance snapshot and SELECT THE SINGLE one whose outfit, grooming, and physical state most plausibly belongs at this place. A ballroom → the formal gown; a battlefield → the armor; a bedroom at night → sleepwear. Do not blend appearances, and do not carry over change-over-time phrasing ("now older", "her hair, once long…"). Describe only what is true in the selected moment.

## STEP 2: Write the Opening Prompt

Write flowing prose, at most 1800 characters, containing these five elements in this order:

1. **Register**: open by naming the shot and the realism vocabulary — "slow dolly-in, photoreal drama" or "static wide, painterly period film".

2. **Actors**: name {{ character.name }} explicitly and describe them from the chosen appearance only — build, hair, face, clothing, distinctive features. Named actors matter here in a way they do not for a playable world: the user will type instructions like "she turns to the window", and the model needs to know who "she" is. If the place snapshots imply other figures, name their roles too ("a innkeeper behind the bar").

3. **Staging**: where everyone is standing and what the camera sees, in layers — foreground, mid, background. Pick **three to six recurring anchors** (a doorway, a fire, a window, a table) and place them concretely. The user will direct against these.

4. **Tension**: the premise. Something is about to happen, or has just happened, or is being withheld. This is what gives the user something to direct toward — "the letter on the table has not been opened", "the room has gone quiet because someone has just walked in". A world with no tension has nothing to steer.

5. **Style**: close on concrete photographic language — light quality, weather, surface texture. Never abstract praise ("epic", "breathtaking", "cinematic masterpiece").

Include at least two elements that move on their own — "steam curls off the cup", "rain ticks against the glass", "the fire gutters". A still opening reads as a photograph and the first instruction has to fight it.

### Constraints

- Present tense
- One coherent opening shot — do NOT script a sequence; the user supplies what comes next
- Camera language must not fight the staging: if you asked for a static wide, do not also describe a whip pan
- Ground every detail in the snapshots provided; invent nothing that contradicts them
- No proper nouns beyond {{ character.name }} and {{ place.name }}
- No negations ("no cars", "not modern") — the model latches onto what you name

## STEP 3: Suggest Opening Directions

Propose 3-5 instructions the user might type first, as short plain-English directions (4-8 words each), specific to this character and place. These become one-tap buttons. Favour beats that pay off the tension you staged: "she opens the letter", "the door swings inward", "push in on her face", "the storm breaks overhead". Avoid over-ambitious multi-step instructions — one beat each.

## Output Format

Provide your final output in this exact format, and nothing else:

<selected_appearance_id>[the id of the appearance you selected]</selected_appearance_id>
<world_prompt>
[your opening prompt]
</world_prompt>
<suggested_actions>
<action>[short direction]</action>
<action>[short direction]</action>
<action>[short direction]</action>
</suggested_actions>

## Example Output (different character/place — match the structure and register, not the content)

<selected_appearance_id>AI-X-2</selected_appearance_id>
<world_prompt>
Slow dolly-in, photoreal period drama with heavy practical firelight. A young ranger sits alone at the long table of a low-beamed tavern room, auburn hair loose and damp, a weathered green cloak hung open over a mud-spattered leather jerkin, a silver-handled bow propped against the bench beside her. In the foreground the table carries a pewter cup, a guttering tallow candle, and a folded letter with a broken wax seal. Mid-ground, a wide stone hearth throws the only real light in the room; behind it the innkeeper works with his back turned, and the far wall is broken by a single rain-streaked window. The room has gone quiet because someone has just come in through the door behind her, and she has not turned around yet. Steam curls off the cup, the candle flame leans and recovers, rain ticks steadily against the glass, and firelight moves across the wet shoulder of her cloak. Warm low-key light, soot-dark beams, and the dull shine of damp leather.
</world_prompt>
<suggested_actions>
<action>she turns toward the door</action>
<action>push in on her face</action>
<action>she unfolds the letter</action>
<action>the innkeeper looks up</action>
</suggested_actions>`;

export default createPrompt(meta, prompt);
