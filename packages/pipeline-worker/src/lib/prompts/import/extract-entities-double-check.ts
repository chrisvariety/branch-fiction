import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  focalStartChapter: v.number(),
  endChapter: v.number(),
  changes: v.string(),
  entities: v.string(),
  toolErrors: v.optional(v.string())
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Entities: Double-Check Pass',
  input: InputSchema
};

const prompt = `**Final pass: Double-check the changes you just made.**

You have finished the unidentified, identified, and world-building passes for chapters {{ focalStartChapter }}–{{ endChapter }}. This is a correctness pass focused ONLY on the entities you added, updated, or merged in this round. Do not review or modify entities you did not touch this round, and do not make changes that aren't grounded in chapters {{ focalStartChapter }}–{{ endChapter }}. This is not a discovery pass, so do not go hunting for new entities to add—the one exception is splitting apart an entity you accidentally combined from two different people or things (see below).

Here is exactly what you changed this round:

<changes_this_round>
{{ changes }}
</changes_this_round>

And here is the current state of each entity you touched:

<changed_entities>
{{ entities }}
</changed_entities>

For each entity you changed this round, verify the following. Only make a change when something you did is genuinely wrong or incomplete—if it already looks correct, leave it untouched and move on.

1. **Labels.**
   - Characters, mentioned individuals, places, deities, organizations, and named objects should use their proper name or most commonly used title as the label.
   - An entity that gained a proper name this round should have that proper name as the label, with any earlier descriptive phrasing moved into the description (not left as the label).
   - World-building elements should use the term as it appears in the world (e.g., "the One Power", "elves").
   - An entity that is still genuinely unnamed should keep a distinctive descriptive label, not a generic one.

2. **Names.** Each entity's names list must contain ONLY exact verbatim phrases from the text that refer to that specific entity. Using \`update_entity\` (add_names / remove_names), check the names you added or changed this round, and remove only these three kinds of bad names:
   - Pronouns (I, me, my, he, she, they, it, …).
   - Generic relational terms that only identify someone from another character's point of view, i.e. kinship/role words like Mom, Dad, sis, brother.
   - Bare generic descriptors with no distinguishing detail ("the man", "the woman", "the guard", "the sword", "the artifact").

   Do NOT remove a name just because it is long or descriptive. Distinctive descriptive phrases that pin down a specific unnamed entity are valid, encouraged names—keep them (e.g. "girl with azure hair and nose ring", "scarred tavern keeper", "guard knocked unconscious and drugged", "cloaked stranger").

   Also remove any name that actually belongs to a different entity (a name wrongly assigned), and add any obvious verbatim alias, title, nickname, or epithet from these chapters that is clearly missing.

3. **Two distinct entities wrongly combined into one.** This is the most damaging error to catch. Read the names list of each entity you touched and confirm every name refers to the SAME individual or thing. The clearest sign of this error is a names list holding two separate proper names that belong to two different individuals (e.g. "Commander Thorne" together with "Elena Ravencrest"). When you find such a conflated entity:
   - Decide which names belong to which real entity.
   - Use \`update_entity\` with \`remove_names\` to strip the names that belong to the other entity off this one (and fix the label/description so they describe only the entity that remains).
   - Then re-home those removed names: use \`add_entity\` to create the separate entity if it does not exist yet, or \`merge_entities\` if it should join an entity that already exists.

   Do this only to separate genuinely different entities—do not split apart the multiple legitimate aliases of a single individual.

4. **Descriptions.** Each description should be a brief (1-2 sentence) present-tense summary of the entity's traits, role, or significance. Fix a description you wrote this round that is stale (contradicted by what was actually revealed) or that still reads as a pre-reveal placeholder for an entity that has since been named or clarified.

5. **Pronouns.** For characters, confirm pronouns are one of "he/him", "she/her", "they/them", "it/its", or "unknown". Correct any you set this round that were guessed wrongly, or update "unknown" if these chapters revealed them.

6. **has_voice.** Confirm \`has_voice\` is \`true\` only for entities whose voice or thoughts the reader directly experiences (spoken dialogue, internal monologue, mental communication, or POV narration) in these chapters. Being merely mentioned, described, or talked about does not count.

7. **Merges you made (or missed).** If you merged entities this round, confirm the surviving entity's label, names, and description are coherent. If an entity you added this round duplicates one you also touched this round, merge them, keeping the named/canonical entity as the primary.

8. **World-building variants.** If you touched a world-building term with distinct variants (e.g., "fire ward" vs "ice ward", "spirit bond" vs "blood bond"), confirm each distinct variant is its own entity rather than being collapsed into the base term, and that names lists were not merged across variants.
{% if toolErrors %}
**Entries worth a closer look.** While adding or updating entities this round, the following errors came up (most often a name colliding with another entity's name). Many of these were probably already resolved as you worked—this list is just a pointer to the spots that were fragile, since the names involved tended to be ambiguous, too generic, or easy to assign to the wrong entity. Glance over the related entities and confirm they ended up correct; only change something if it is actually still wrong.

<flagged_errors>
{{ toolErrors }}
</flagged_errors>
{% endif %}
After reviewing this round's changes and making any corrections, end with a short prose summary covering: how many of your changes you corrected versus left as-is, and any remaining concerns.`;

export default createPrompt(meta, prompt);
