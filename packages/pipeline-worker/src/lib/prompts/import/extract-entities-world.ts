import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Entities: World-Building Pass',
  input: InputSchema
};

const prompt = `**Pass 3 of 3: World-building elements.**

Now identify elements that are (or could be) shared by multiple entities and are unique to this fictional world: magic systems, fictional species, cultural practices, magical artifacts, etc. (e.g., "the One Power", "elves"). Pay special attention to common everyday words that take on specialized meanings in this world—if a term refers to a specific magical or cultural concept rather than its ordinary meaning, extract it as a world-building element.

**Categories to Extract** (these are examples, not exhaustive—extract any unique world-building element):

1. **Species and Creatures**: Fantasy-specific sentient races, monsters, or significant beings (e.g., "Orcs", "Elves", "Dragons", "Golems", "Griffins", "shadow elves", "dire wolves"). This category is for the species/creature type itself, not individual named members.

2. **Magic Systems and Sources**: The fundamental rules, principles, and power sources that govern supernatural abilities. This includes the underlying framework of magic (e.g., "The Weave", "Allomancy", "Channeling the One Power", "Bloodmagic") and conduits or power sources that enable magic (e.g., "Ley Lines", "Mana Crystals", "The Astral Flow", "Elemental Nodes").

3. **Historical Events, Legends, or Prophecies**: Named events from the world's lore that are referenced in the text, including wars, foundational myths, and specific prophecies (e.g., "The Last Great War", "The War of Broken Crowns", "The Song of Eldara", "The Prophecy of the Twin Kings").

4. **Fictional Languages**: Named languages unique to the world (e.g., "Elvish", "Draconic", "The Old Tongue", "Valarinth").

5. **Flora, Fauna, and Materials**: Unique plants, animals, and special substances that are part of the world's environment or economy (e.g., "Kingsfoil" (flora), "Moonblossom" (plant), "Shadow-cat" (fauna), "Mithril" (material), "voidsteel" (metal)). This category is for raw materials, plant/animal species, and natural substances.

6. **Laws, Oaths, and Codes**: Named laws, binding oaths, or formal codes of conduct that govern individuals or groups (e.g., "The Mage's Covenant", "The Code of the Kingsguard", "The First Law of Magic", "The Code of the Silver Shield").

7. **Cultural Elements**: Named religions, holidays, customs, traditions, and cultural practices unique to the world (e.g., "The Path of Flame" (religion), "The Day of Ascension" (holiday), "The Festival of Stars" (festival), "the rite of silent mourning" (custom)).

8. **World-Specific Concepts and Rituals**: Named rituals, ceremonies, unique phenomena, or abstract ideas that are not broad systems. These are often specific applications of magic or key cultural events (e.g., "The Choosing Ceremony", "The Harrowing", "The Convergence", "The Ritual of Soul-Forging").

**Pass-specific field guidelines:**

- **label**: The term as it appears in the world (e.g., "the One Power", "elves", "royal signet").

- **names**: Include ONLY exact verbatim identifiers from the text that specifically refer to this entity. Include all verbatim terms used in the text to refer to this concept. When both a base term and specific variants exist (e.g., "ward" with variants "fire ward" and "ice ward", or "bond" with variants "spirit bond" and "blood bond"), extract variants as separate entities if they have unique properties, rules, appearance, function, or origin that distinguish them. Extract ALL such variants, not just the most prominent one—if "fire ward" and "ice ward" both have distinct characteristics, extract both. Each entity's names list should contain only the exact phrases used to refer to that specific concept.

  Additionally exclude common words used in their ordinary (non-fictional) sense.

**Workflow:**

1. Work through the preloaded chapters in order, identifying entities matching the focus categories above. Before adding or updating any entity, check the existing entities list (and any entities already touched earlier in this conversation) carefully to avoid duplicates.

2. For each new entity, use \`add_entity\`.

3. When you encounter an entity that already exists:
   - If new verbatim names/references appear, use \`update_entity\` with \`add_names\`
   - If new information is revealed (description details), use \`update_entity\`

4. Pay special attention to:
   - Common everyday words that take on specialized meanings in this world
   - Subtle introductions of fictional concepts, species, or systems
   - Comparative introductions where one concept is explained as contrast to another (e.g., "unlike X, Y has these properties")
   - Distinguishing between base terms and specific variants—extract ALL variants with unique properties/rules/appearance/function, not just one (e.g., both "fire ward" and "ice ward" if both have distinct characteristics, both "spirit bond" and "blood bond" if they differ in their effects)

**Process:**

For each chapter, before calling any tools, think through:
- What world-building elements appear in this chapter?
- Are any of these already in the existing entities list or already added earlier in this conversation? (Check carefully!)
- What exact verbatim phrases are used to refer to each entity?

Then invoke \`add_entity\` / \`update_entity\` / \`merge_entities\` for each entity.

After all chapters are done, end with a short prose summary covering: total chapters read, number of entities added / updated / merged, and any notable patterns about entity references.`;

export default createPrompt(meta, prompt);
