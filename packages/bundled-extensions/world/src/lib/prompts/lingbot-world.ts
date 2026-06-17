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
  name: 'LingBot World Prompt',
  input: InputSchema
};

const prompt = `You are writing the base prompt for LingBot, a real-time interactive world model that users navigate with movement and look controls. Your task is to build a navigable world description that will be used to generate a seed image.

You will be given:
1. A character with one or more appearance snapshots from different moments in their story
2. A place with one or more location snapshots

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

Your task has two steps:

## STEP 1: Select the Appearance That Fits the Place

The place is your anchor. Read through all the appearance snapshots to understand which story moment each represents. Then SELECT THE SINGLE appearance whose outfit, grooming, and physical state most plausibly belongs at this place.

Matching guidance:
- A ballroom setting → choose the formal gown appearance
- A battlefield → choose the armored, battle-worn appearance
- Riding terrain → choose the travelling/mounted appearance
- When place snapshots and an appearance describe the same moment or setting, that is a strong match

## STEP 2: Write the Base Prompt (2-4 sentences)

Describe the character using ONLY the chosen appearance as a self-contained visual description of what is true now. Do NOT carry over change-over-time phrasing ("now older", "her hair, once long...") or blend in details from other appearances.

Structure your prompt with these four components:

**1. FOV + Subject** (Required opening)
- ALWAYS open with a third-person over-the-shoulder view following the character, with the character centered in frame
- Describe the character's concrete appearance (clothing, hair, distinctive features) from the chosen appearance only
- Honor what the character actually IS, and pose them accordingly, inferring their nature from the appearance description and choose the bearing that fits it, e.g.:
  - A winged creature or dragon → airborne, wings spread, in flight above the terrain (not walking)
  - A rider → mounted on their horse/mount
  - A bird → soaring through the air
  - A fish or sea creature → swimming
  - An ordinary person → striding or walking on foot
- Name the specific mode of movement (flying, soaring, riding, striding, swimming) that matches the body described

**2. Object Layers**
- Describe near (ground level), mid (focal elements), and far (backdrop) planes of the place
- Ground your descriptions in the place snapshots provided

**3. Camera Framing**
- Keep the character centered, seen from behind/over the shoulder so the user can navigate the world ahead
- Use position-only language for the viewpoint
- Do NOT direct camera movement (no "the camera pans", "we follow", "pushing forward"), the user will control  navigation

**4. Atmosphere**
- One closing phrase for palette, energy, and style

## Critical Constraints

- The over-the-shoulder framing and centered character are non-negotiable — never switch to first-person or place the character off to the side
- The prompt must align with the seed image and not contradict itself
- No proper nouns beyond the character and place names
- Do not invent details that contradict the chosen snapshots
- Ambient world motion and the subject's implied bearing are acceptable, but no camera movement directions

## Output Format

Provide your answer in exactly this format, and nothing else:

<selected_appearance_id>[the id of the appearance you chose]</selected_appearance_id>
<world_prompt>
[your 2-4 sentence base prompt]
</world_prompt>

## Example Output (different character/place — match the framing and structure, not the content)

<selected_appearance_id>A-X-1</selected_appearance_id>
<world_prompt>
The video presents a third-person over-the-shoulder view following a sword-slung rider in a white tunic and dark sash, hair tied in a high topknot, seated firmly on a brown horse whose long braided tail sways as it moves steadily through curling valley mist. Wildflower meadows of violet lupines and crimson poppies spread across the landscape between weathered boulders, while a hamlet of half-timbered cottages, stone watchtowers, and a moss-eaten ruined portal arch stands in the misted middle distance. Far ahead on a craggy peak, a many-spired castle with crimson pennants snapping from its towers grows clearer against a vast ringed gas giant and a pale crescent moon hanging in the peach-tinted twilight sky. Painterly fantasy storybook atmosphere."
</world_prompt>
`;

export default createPrompt(meta, prompt);
