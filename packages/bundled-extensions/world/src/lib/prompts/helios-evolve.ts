import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  currentPrompt: v.string(),
  userIntent: v.string()
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Helios Evolve Prompt',
  input: InputSchema
};

const prompt = `You are evolving the prompt for Helios, a real-time video generation model. The scene is already live. The user has typed a short steering intent, and your task is to rewrite the CURRENT prompt into a new full prompt that folds that intent in as a single new beat.

Here is the current prompt:
<current_prompt>
{{ currentPrompt }}
</current_prompt>

Here is the user's steering intent:
<user_intent>
{{ userIntent }}
</user_intent>

## How to Evolve the Prompt

- **Preserve continuity**: Keep the SAME subject, environment, lighting, visual aesthetic, and camera/shot type as the current prompt. This is the next moment of the same shot, not a new scene.
- **Apply the intent as ONE change**: Fold the user's intent in as a single new action or change to the subject or scene. Express it concretely and visually.
- **Let it ripple naturally**: Allow the change to affect the environment where it makes sense (light, particles, reactions, swaying foliage), but do not introduce unrelated new elements.
- **Keep the camera locked**: Preserve the closing shot-type sentence (framing + facing the camera) and keep the subject oriented toward the viewer.

After rewriting the prompt, also propose 3-5 fresh actions the user might take NEXT, as short imperative phrases (3-6 words each). Base them on the NEW scene state you just wrote — they should reflect whatever just changed. Keep them specific to who the character is and where they are.

The model handles SMALL, self-contained changes best — but small does NOT mean timid. Make them lively and expressive. Favor two kinds:
- **Expressive body movements or expressions** the character can perform in place: "break into a grin", "laugh", "dance in place", "jump for joy", "throw the head back laughing", "wink at the camera", "blow a kiss", "strike a dramatic pose", "draw the sword", "breathe a plume of fire", "spread the wings wide". Lean into the character's personality and emotion — give them energy.
- **A small new element appearing** that fits the context: for a dog scene "a cat wanders into frame"; for a tavern "a stranger sits down nearby"; for a forest "a bird lands on a branch".

Avoid two failure modes:
- **Boring micro-adjustments** that barely read on camera: "shift weight to one hip", "tilt head slightly", "rest hands on hips", "adjust posture". These are dull — prefer a clear, expressive beat with real emotional or physical energy.
- **Things the model can't render**: locomotion, climbing, multi-step sequences, or manipulating the environment (e.g. "pull herself up the rope", "plant a foot on the rock", "reach for the next handhold", "walk down the path"). Keep each action to a single, immediate beat the character does without leaving frame.

## Constraints and Requirements

- Write in present tense
- Describe one coherent moment - do NOT describe a sequence of events or actions
- Rewrite the WHOLE prompt as flowing prose, similar in length to the current one. Do not output a diff or only the changed part.
- Do not use proper nouns beyond those already in the current prompt
- Do not contradict details established in the current prompt

## Output Format

Provide your final output in this exact format, and nothing else:

<world_prompt>
[the evolved prompt]
</world_prompt>
<suggested_actions>
<action>[short imperative phrase]</action>
<action>[short imperative phrase]</action>
<action>[short imperative phrase]</action>
</suggested_actions>

## Example (different scene/intent — match the continuity and structure, not the content)

Current prompt: "A young ranger with windswept auburn hair and a weathered green hooded cloak stands among the moss-draped roots of an ancient forest, a worn leather quiver slung across her back and a silver-handled bow held loosely at her side. Mushroom-dotted roots and ferns crowd the foreground, towering gnarled oaks wound with glowing blue vines rise through the middle distance, and far behind her a mist-wreathed valley opens toward jagged snow-capped peaks. Shafts of golden afternoon light slant through the canopy, catching the loose strands of her hair and glinting off the bow's polished handle. She stands relaxed and alert, one hand resting on the strap of her quiver, chin lifted with quiet confidence. Painterly cinematic fantasy 3D render with rich environmental depth and warm saturated colors. Medium shot focused on the ranger, facing the camera."

User intent: "a fox appears"

Output:
<world_prompt>
A young ranger with windswept auburn hair and a weathered green hooded cloak stands among the moss-draped roots of an ancient forest, a worn leather quiver slung across her back and a silver-handled bow held loosely at her side. A small russet fox slips out from the mushroom-dotted ferns in the foreground, padding lightly toward her as she turns her gaze down to meet it, the corner of her mouth lifting. The disturbed ferns and glowing blue vines on the gnarled oaks tremble softly in the fox's wake, while the mist-wreathed valley and snow-capped peaks hold steady far behind her. Shafts of golden afternoon light slant through the canopy, catching the loose strands of her hair and glinting off the bow's polished handle and the fox's bright fur. Painterly cinematic fantasy 3D render with rich environmental depth and warm saturated colors. Medium shot focused on the ranger, facing the camera.
</world_prompt>
<suggested_actions>
<action>kneel down and laugh</action>
<action>scoop up the fox</action>
<action>spin around in delight</action>
<action>a second fox appears</action>
</suggested_actions>`;

export default createPrompt(meta, prompt);
