import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Entities: Identified Pass',
  input: InputSchema
};

const prompt = `**Pass 2 of 3: Identified unique entities.**

Now identify named characters, objects, places, etc. with specific proper names (e.g., "Eragon", "The Sword of Shannara", "Camelot") in the preloaded chapters.

**Categories to Extract:**

1. **Characters**: Named entities that actively participate in the narrative and drive the plot forward through their actions, decisions, or presence. This includes protagonists, antagonists, allies, mentors, and any entity who plays an active role in events. Characters typically have agency, make choices that affect outcomes, or directly influence other characters. Any entity type (people, dragons, sentient objects, divine beings, talking artifacts, magical creatures, etc.) can be a CHARACTER if they actively participate in the story. Each individual character is a separate entity—create separate entities for twins, siblings, or any individuals mentioned together.

2. **Mentioned Individuals**: Named persons or individual beings who are mentioned or described, but whose perspective (e.g., POV, spoken dialogue, internal monologue) is not directly shared with the reader. These are figures who do not pass the 'Character' litmus test.

3. **Places**: Named locations including countries, cities, specific buildings, and unique named structures or locations (e.g., "The Dragon's Roost", "The Crystal Spires"). Include any location that is treated as a proper noun in the text, even if the name is also a common noun (e.g., "The Forest", "The River").

4. **Deities or Divine Figures**: Named beings that are worshipped, have a defined divine portfolio, or are explicitly referred to as a god, goddess, demigod, or similar divine entity (e.g., "Zephyra, the Goddess of Winds", "The Sunken God").

5. **Organizations**: Named formal and informal groups that act as collective entities within the world. This includes guilds, military orders, noble houses, clans, religious orders, secret societies, governing bodies (e.g., "The Mages' Guild", "House Ravencrest", "The Order of the Silent Blade", "The Council of Elders").

6. **Significant Objects**: Named objects, artifacts, weapons, or items with proper names (e.g., "Excalibur", "Dawnbreaker, the Blade of the First Light"). Consider an object significant if it is specially made for a character, described in detail, or pivotal to the plot.

**Pass-specific field guidelines:**

- **label**: The entity's proper name or most commonly used title (e.g., "Elena Ravencrest", "Commander Thorne").

- **names**: Include ONLY exact verbatim identifiers from the text that specifically refer to this entity. Include:
  - Proper names and titles (e.g., "Elena Ravencrest", "Commander Thorne", "the Archmage")
  - Diminutives and nicknames that function as names (e.g., "Lena", "Thorne")
  - Formal titles used as identifiers (e.g., "Commander", "the Professor")
  - Distinctive epithets (e.g., "the Shadowbinder", "the cloaked stranger")

  Think of these as the phrases you would search for to count meaningful mentions of this entity in the text.

**Workflow:**

1. Work through the preloaded chapters in order, identifying entities matching the focus categories above. Before adding or updating any entity, check the existing entities list (and any entities you've already touched earlier in this conversation, including the unidentified pass) carefully to avoid duplicates.

2. For each new entity, use \`add_entity\`.

3. When you encounter an entity that already exists:
   - If new verbatim names/references appear, use \`update_entity\` with \`add_names\`
   - If new information is revealed (description details, pronouns), use \`update_entity\`
   - If an entity starts speaking, thinking, or has POV narration for the first time, use \`update_entity\` to set \`has_voice\` to true

4. When a "grand reveal" occurs (e.g., "the hooded figure" is revealed to be "Marcus"), use \`merge_entities\` to combine them, with the named entity as the primary. Pay particular attention to entities you added in the unidentified pass—they may now have proper names.

5. Pay special attention to:
   - Multiple names or titles for the same entity
   - Entities mentioned in passing that later become significant

**Process:**

For each chapter, before calling any tools, think through:
- What named entities appear in this chapter?
- Are any of these already in the existing entities list or already added earlier in this conversation? (Check carefully!)
- What exact verbatim phrases are used to refer to each entity?
- Do any existing entities speak, think, or have POV narration in this chapter? (Check has_voice status!)
- Are there any reveals or merges that need to happen (especially with unidentified-pass entities)?

Then invoke \`add_entity\` / \`update_entity\` / \`merge_entities\` for each entity.

After all chapters are done, end with a short prose summary covering: total chapters read, number of entities added / updated / merged, and any notable patterns about entity references.`;

export default createPrompt(meta, prompt);
