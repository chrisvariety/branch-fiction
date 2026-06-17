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

const prompt = `You are creating an opening prompt for Helios, a real-time video generation model. This opening prompt will establish a living scene that a user can then interact with and steer.

You will be given a character and a place. The character has multiple appearance descriptions from different points in a story (representing different outfits, grooming states, and physical conditions at various narrative moments). Your task is to select the single appearance that best fits the given place, then write a detailed visual prompt for Helios.

Here is the character name:
<character_name>
{{ character.name }}
</character_name>

Here are the character's appearance descriptions across different story moments:
<character_appearances>
{% for a in character.appearances -%}
<appearance id="{{ a.id }}" title="{{ a.title }}" chapters="{{ a.chapterRange }}">
{{ a.content }}
</appearance>
{% endfor -%}
</character_appearances>

Here is the place name:
<place_name>
{{ place.name }}
</place_name>

Here are the place snapshot descriptions:
<place_snapshots>
{% for a in place.appearances -%}
<snapshot id="{{ a.id }}" title="{{ a.title }}" chapters="{{ a.chapterRange }}">
{{ a.content }}
</snapshot>
{% endfor -%}
</place_snapshots>

## Your Task

Complete this task in two steps:

### Step 1: Select the Appropriate Character Appearance

The place is your anchor. Analyze each character appearance and determine which single appearance best fits the place context. Consider:

- **Outfit appropriateness**: Does the clothing match the setting? (e.g., formal gown for a ballroom, armor for a battlefield, sleepwear for a bedroom at night)
- **Grooming and physical state**: Does the character's condition match what would be plausible at this location?
- **Narrative alignment**: When a place snapshot and a character appearance describe the same moment or setting in the story, that indicates a strong match

Select ONE appearance ID. Do not blend or combine elements from multiple appearances.

### Step 2: Write the Opening Prompt for Helios

Using ONLY the selected appearance, write a self-contained visual description of what exists in this moment. This is critical: do not carry over temporal phrasing that describes change over time (phrases like "now older", "her hair, once long, is now short", "no longer wearing") or pull details from appearances you did not select.

Your opening prompt must include all five of these elements, woven together as flowing prose (not as a bulleted list):

1. **Subject**: Concrete physical characteristics of the character drawn from the chosen appearance only. Include face, hair, build, distinctive features, and clothing details.

2. **Environment**: Describe the place with spatial depth. Layer the description to include near, mid, and far elements. Use only details that are grounded in the place snapshots provided - do not invent contradictory elements.

3. **Lighting**: Describe how light actually falls on surfaces and interacts with the scene. Be specific (e.g., "warm light catching the edge of her jaw and glinting off the brass buttons of her coat") rather than generic (e.g., "good lighting").

4. **Mood**: Convey mood through the character's posture, body language, and actions. Avoid abstract feeling words - show, don't tell.

5. **Camera**: End your prompt with an explicit camera instruction. Helios performs best when you specify the shot type (close-up, medium shot, or wide shot) and ensure the subject faces the camera. Examples:
   - "Medium shot focused on {{ character.name }}, facing the camera."
   - "Close-up of {{ character.name }} looking toward the camera, slow push-in."
   - "Wide shot with {{ character.name }} in three-quarter view toward the viewer."

### Step 3: Suggest Interactive Actions

The scene is live and steerable — the user can type a short intent that nudges the scene forward. Propose 3-5 actions the user might take, as short imperative phrases (3-6 words each). These must be SPECIFIC to who this character is and where they are — derive them from the chosen appearance and the place, not generic filler.

- A dragon → "open mouth and breathe fire", "spread wings wide"
- A character carrying a sword → "pull out the sword", "raise the blade overhead"
- A character at a campfire → "warm hands by the fire"

Favor actions the character could plausibly perform from their current pose and surroundings. Avoid actions that would break continuity or require leaving the scene.

### Constraints and Requirements

Your opening prompt must follow these rules:

- Write in present tense
- Describe one coherent establishing shot - do NOT describe a sequence of events or actions
- The character must face the camera (front-facing or three-quarter view), not turned away
- Name the visual aesthetic style once in your description (e.g., "cinematic realism", "painterly aesthetic", "documentary style")
- Do not use proper nouns beyond the character and place names already provided
- Do not invent details that contradict the provided snapshots
- Do not blend details from multiple character appearances

## Output Format

Provide your final output in this exact format, and nothing else:

<selected_appearance_id>[the id of the appearance you selected]</selected_appearance_id>
<world_prompt>
[your complete opening prompt for Helios]
</world_prompt>
<suggested_actions>
<action>[short imperative phrase]</action>
<action>[short imperative phrase]</action>
<action>[short imperative phrase]</action>
</suggested_actions>

## Example Output (different character/place — match the five-element style and structure, not the content)

<selected_appearance_id>A-X-1</selected_appearance_id>
<world_prompt>
A young ranger with windswept auburn hair and a weathered green hooded cloak stands among the moss-draped roots of an ancient forest, a worn leather quiver slung across her back and a silver-handled bow held loosely at her side. Mushroom-dotted roots and ferns crowd the foreground, towering gnarled oaks wound with glowing blue vines rise through the middle distance, and far behind her a mist-wreathed valley opens toward jagged snow-capped peaks. Shafts of golden afternoon light slant through the canopy, catching the loose strands of her hair and glinting off the bow's polished handle. She stands relaxed and alert, one hand resting on the strap of her quiver, chin lifted with quiet confidence. Painterly cinematic fantasy 3D render with rich environmental depth and warm saturated colors. Medium shot focused on the ranger, facing the camera.
</world_prompt>
<suggested_actions>
<action>draw an arrow from the quiver</action>
<action>raise the bow and take aim</action>
<action>pull the hood back</action>
<action>kneel down to read a track</action>
</suggested_actions>`;

export default createPrompt(meta, prompt);
