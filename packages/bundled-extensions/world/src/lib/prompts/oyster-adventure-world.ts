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
  name: 'HappyOyster Adventure World Prompt',
  input: InputSchema
};

const prompt = `You are writing the world prompt for HappyOyster Adventure, a real-time world model the user plays with movement, look, and interaction controls. The user IS the character — the prompt must put them inside the body, not in front of it.

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

## STEP 2: Write the World Prompt

Write flowing prose, at most 1800 characters, containing these five elements in this order:

1. **Register**: open by naming the camera and realism vocabulary — "third-person action-game camera, photoreal" or "over-the-shoulder view, painterly realism".

2. **Subject (second person, always)**: "You are {{ character.name }}, …" then the concrete physical details from the chosen appearance — build, hair, face, clothing, distinctive features. Second person is not optional: it is what gives the movement controls something to attach to. Never write {{ character.name }} as someone observed from outside.

3. **World**: the terrain and environment in layers — what is underfoot, what is at mid distance, what is on the horizon. Pick **three to six recurring anchors** (a landmark, a light source, a texture, a sound-making object) and name them concretely. Anchors hold the world together as the user moves; one-off scenery does not.

4. **Dynamics**: what moves on its own and how the world answers the player. Use active verbs — "mist drifts between the trunks", "lanterns sway and creak", "loose scree slides underfoot". Give {{ character.name }} an obvious affordance the controls can express: something to climb, chase, push through, or pounce on.

5. **Style**: close on concrete photographic language — light quality, weather, surface texture. Never abstract praise ("epic", "breathtaking", "cinematic masterpiece").

Also give the character a **premise** — a small objective or disruption that gives the world forward momentum ("you are tracking something that has been circling the camp since dusk"). A world with no premise goes static.

### Constraints

- Present tense, second person for the player-character throughout
- Third-person camera following {{ character.name }} — the user needs to see who they are
- Ground every detail in the snapshots provided; invent nothing that contradicts them
- No proper nouns beyond {{ character.name }} and {{ place.name }}
- No negations ("no cars", "not modern") — the model latches onto what you name
- Do not describe a sequence of events; describe a world that is already in motion

## STEP 3: Suggest Interaction Verbs

Propose 3-5 interaction verbs this world should offer beyond the built-in Jump, Attack, Crouch, and Sprint. One or two words each, capitalized like a control label, and specific to what {{ character.name }} actually is — a winged creature gets "Take_Flight", a swordsman gets "Parry", a scholar gets "Read". These seed the control pad until the live world advertises its own.

## Output Format

Provide your final output in this exact format, and nothing else:

<selected_appearance_id>[the id of the appearance you selected]</selected_appearance_id>
<world_prompt>
[your world prompt]
</world_prompt>
<suggested_actions>
<action>[interaction verb]</action>
<action>[interaction verb]</action>
<action>[interaction verb]</action>
</suggested_actions>

## Example Output (different character/place — match the structure and register, not the content)

<selected_appearance_id>AI-X-3</selected_appearance_id>
<world_prompt>
Third-person action-game camera, photoreal with heavy atmospheric haze. You are a young ranger in a weathered green hooded cloak, auburn hair windswept across your face, a worn leather quiver at your back and a silver-handled bow loose in your left hand. Moss-slick roots buckle the path underfoot; ahead, four gnarled oaks wound with glowing blue vines mark the way like pillars, and beyond them a collapsed stone watchtower leans over a ravine where mist pours downward without ever reaching the bottom. Something has been circling the camp since dusk and you are tracking it. Mist drifts between the trunks and parts as you move through it, the blue vines pulse slowly brighter when you come near, loose scree slides and rattles away down the ravine edge, and the watchtower's hanging chain swings and knocks against stone. The oaks are climbable; the ravine can be crossed at the fallen trunk. Late afternoon light comes in low and gold through the canopy, wet bark shines almost black, and every surface carries a fine bead of damp.
</world_prompt>
<suggested_actions>
<action>Draw_Bow</action>
<action>Climb</action>
<action>Whistle</action>
<action>Track</action>
</suggested_actions>`;

export default createPrompt(meta, prompt);
