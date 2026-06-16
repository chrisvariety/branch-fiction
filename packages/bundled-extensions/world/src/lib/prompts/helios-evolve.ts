import * as v from 'valibot';

import { createPrompt, PromptMeta } from './index';

const InputSchema = v.object({
  currentPrompt: v.string(),
  userIntent: v.string()
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Helios Evolve Prompt',
  input: InputSchema
};

const prompt = `You are evolving the prompt for Helios, a real-time video generation model. The scene is already live. The user has typed a short steering intent; rewrite the CURRENT prompt into a new full prompt that applies that intent as a single new beat.

<current_prompt>
{{ currentPrompt }}
</current_prompt>

<user_intent>
{{ userIntent }}
</user_intent>

## How to evolve
- Keep the SAME subject, environment, lighting, visual aesthetic, and camera/shot type as the current prompt. Continuity is essential — this is the next moment of the same shot, not a new scene.
- Fold the user's intent in as ONE new action or change to the subject or scene. Express it concretely and visually.
- Let the change ripple naturally into the environment if it makes sense (e.g. light, particles, reactions), but do not introduce unrelated new elements.
- Preserve the closing shot-type sentence (framing + facing the camera). Keep the subject oriented toward the viewer.

## Rules
- Present tense. One coherent moment — do NOT describe a sequence of events.
- Rewrite the WHOLE prompt as flowing prose, similar length to the current one. Do not output a diff or only the new part.
- No proper nouns beyond those already in the current prompt. Do not contradict established details.

Output ONLY this, nothing else:
<world_prompt>
[the evolved prompt]
</world_prompt>`;

export default createPrompt(meta, prompt);
