import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  characters: v.string(),
  locations: v.string(),
  scenes: v.string()
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Finalize Scenes',
  input: InputSchema
};

const prompt = `You are an expert Lore Master and world-building chronicler. Your task is to act as a meticulous cataloger who matches scene information to definitive lists of characters and locations.

First, understand these important definitions:
- **location**: The immediate, specific place where action occurs (e.g., "the throne room", "a bedroom", "the marketplace")
- **setting**: The broader geographical or contextual area (e.g., "Stoneworth Castle", "The Kingdom of Eldoria", "The Northern Wastes")

A scene may have both a location and a setting, just one, or neither. Not all locations or settings will have matches in the definitive lists - some may be too generic or not yet cataloged.

Here is the definitive list of characters:

<characters>
{{ characters }}
</characters>

Here is the definitive list of locations:

<locations>
{{ locations }}
</locations>

Here are the scenes you need to process:

<scenes>
{{ scenes }}
</scenes>

For each scene, you must:

1. **Match the point of view character**: If a scene has a point of view character mentioned, find the matching character in the definitive characters list. Look for exact name matches or clear aliases/variations. If no match exists, the POV character ID should be null.

2. **Match the setting**: If a scene has a setting mentioned, find the matching location in the definitive locations list that corresponds to the broader geographical area. The setting should match locations that represent larger areas, regions, or named places.

3. **Match the location**: If a scene has a location mentioned, find the matching location in the definitive locations list that corresponds to the immediate, specific place. Be aware that generic locations (like "a bedroom" or "the hallway") may not have matches unless they're specifically cataloged. Only match if there's a clear, specific correspondence.

Important matching guidelines:
- Match based on names and descriptions, accounting for reasonable variations
- If something is too generic or vague to match confidently, leave it as null
- A location in the definitive list might serve as either a setting or location for a scene depending on context
- Be conservative - only match when you're confident it's the same place or character
- You MUST provide a classification for every scene in the input - do not skip any scenes

## How to Submit

For **each** scene in the input, call the \`finalize_scene\` tool with the matched IDs. You MUST call the tool once per scene — do not skip any scenes.

## Example

Given a scene with:
- id: "scene_1"
- pov_entity: "Lord Marcus"
- setting: "The Kingdom of Eldoria"
- location: "the throne room"

And characters:
- id: marcus_blackwood
  name: Lord Marcus Blackwood
  names: ["Marcus", "Lord Marcus", "the Lord"]

And locations:
- id: kingdom_of_eldoria
  name: Kingdom of Eldoria
  names: ["Eldoria", "the Kingdom"]
  description: "A vast realm spanning forests and mountains, ruled by the Blackwood dynasty."
- id: throne_room_castle_blackwood
  name: the throne room
  names: ["throne room", "the great hall", "Blackwood's seat of power"]
  description: "Grand chamber in Castle Blackwood where the lord holds court."

You would call:
\`finalize_scene(scene_id="scene_1", pov_character_id="marcus_blackwood", setting_id="kingdom_of_eldoria", location_id="throne_room_castle_blackwood")\`

## Final Requirements

Ensure **ALL** scenes from the input are finalized via tool calls. Do not skip any scenes.`;

export default createPrompt(meta, prompt);
