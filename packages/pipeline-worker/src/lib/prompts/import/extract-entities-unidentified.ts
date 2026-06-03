import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Entities: Unidentified Pass',
  input: InputSchema
};

const prompt = `**Pass 1 of 3: Unidentified but significant entities.**

Identify characters or objects that are specifically described with distinctive details whose narrative identity cannot yet be linked to a specific named individual at the time of introduction. Extract any entity that appears without a proper name at their first introduction in the text, even if they are named later in the same chapter or many chapters later. This helps track their actions and references throughout their complete narrative arc.

**Categories to Extract:**

1. **Characters (Unnamed)**: Entities that actively participate in the narrative but whose identity cannot yet be linked to a named individual at their first textual appearance. Any entity type (people, dragons, sentient objects, divine beings, talking artifacts, magical creatures, etc.) can be a CHARACTER if they actively participate in the story. Extract only if they have distinctive identifying details that distinguish them from generic roles. Good examples: "warrior with facial scar and missing finger", "knight in obsidian armor with violet cape", "ancient serpent with silver scales and broken horn", "whispering mirror in eastern tower". Bad examples: "the soldier", "the knight", "the dragon", "the mirror" (too generic); "Grimstone", "Kael", "Seraphine" (already named—these belong in the named entities pass, not here).

2. **Mentioned Individuals (Unnamed)**: Persons or beings who are mentioned or described but whose identity cannot yet be linked to a named individual when first referenced and whose perspective is not directly shared with the reader. Extract only with distinctive details. Good examples: "hazel-eyed crimson-haired warrior", "tavern keeper with facial scars". Bad examples: "the soldier", "the innkeeper" (too generic); "Lord Varen", "Mira" (already named).

3. **Significant Objects (Unnamed)**: Objects, artifacts, or items that have not yet been given a proper name when first introduced but are described with distinctive identifying details. Extract if they are set apart from generic objects by their origins (specially crafted, gifted, found, inherited, etc.), unique descriptive details, or notable roles in events. Good examples: "silver locket with intricate runes", "armored breastplate with wyrm emblem", "enchanted compass pointing to desires". Bad examples: "the locket", "the sword", "the compass" (too generic); "Stormbringer", "the Ashen Crown" (already named).

4. **Places (Unnamed)**: Locations that have not yet been given a proper name when first introduced but are specifically identified with distinctive contextual or descriptive details. Extract if they are recurring locations, significant to the plot, or distinguished from generic spaces by their context or description. Good examples: "the training courtyard", "the eastern tower", "the tavern where they first met", "the hidden chamber beneath the throne room". Bad examples: "the room", "the street", "the building" (too generic); "Thornwall", "the Whispering Depths" (already named).

**Pass-specific field guidelines:**

- **label**: A descriptive label that distinguishes this specific entity (e.g., "enchanted compass that points to desires" not just "compass", "guard knocked unconscious and drugged" not just "guard"). Prefer a lowercase descriptive label when the entity is unnamed at first appearance. If a proper name is revealed later in the preloaded chapters, you can either use \`update_entity\` to swap the label to the proper name (moving descriptive details into description) or—if the reveal is right there in the same reading—add the entity directly with the proper name as the label, as long as the descriptive phrases still appear in the names list (e.g., "ancient blade with glowing runes" becomes label: "Stormbringer" with descriptive details moved to description).

- **names**: Include ONLY exact verbatim identifiers from the text that specifically refer to this entity. Include:
  - Distinctive epithets (e.g., "the shadowbinder", "cloaked stranger")
  - Physical descriptors with specific details (e.g., "girl with azure hair and nose ring", "scarred tavern keeper")
  - Contextual descriptors that identify a specific entity (e.g., "guard knocked unconscious and drugged")
  - Proper names if revealed later (e.g., if "rider with fuchsia hair" is later named "Kira", include both names)

  Think of these as the phrases you would search for to count meaningful mentions of this entity in the text.

**Workflow:**

1. Work through the preloaded chapters in order, identifying entities matching the focus categories above. Before adding or updating any entity, check the existing entities list (and any entities you've added earlier in this conversation) carefully to avoid duplicates.

2. For each new entity, use \`add_entity\`.

3. When you encounter an entity that already exists:
   - If new verbatim names/references appear, use \`update_entity\` with \`add_names\`
   - If new information is revealed (description details, pronouns), use \`update_entity\`
   - If an entity starts speaking, thinking, or has POV narration for the first time, use \`update_entity\` to set \`has_voice\` to true

4. When an unnamed entity gains a proper name (e.g., "hooded figure" is revealed to be "Marcus", or "ancient blade" is revealed to be "Stormbringer"), first check whether the named entity already exists. If it does, use \`merge_entities\` to combine the unnamed entity with the existing named one. If the named entity doesn't exist yet, use \`update_entity\` to add the proper name to the names list and update the label (moving descriptive details to the description field). The entity continues to be tracked as originally unidentified.

5. Pay special attention to:
   - Any entity whose identity cannot yet be linked to a named individual at first mention—extract them even if they receive a proper name later in the same chapter
   - When unnamed entities gain names, add the proper name to their names list (or merge if the named entity already exists separately)
   - Distinctive physical or contextual details that identify specific entities
   - Avoiding generic descriptors without distinguishing features

**Process:**

For each chapter, before calling any tools, think through:
- What unnamed but significant entities appear in this chapter?
- Are any of these already in the existing entities list or already added earlier in this conversation? (Check carefully!)
- What exact verbatim phrases are used to refer to each entity?
- Do any existing entities speak, think, or have POV narration in this chapter? (Check has_voice status!)
- Are there any reveals or merges that need to happen?

Then invoke \`add_entity\` / \`update_entity\` / \`merge_entities\` for each entity.

After all chapters are done, end with a short prose summary covering: total chapters read, number of entities added / updated / merged, and any notable patterns about entity references.`;

export default createPrompt(meta, prompt);
