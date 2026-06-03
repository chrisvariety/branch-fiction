import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  entity: v.object({
    name: v.string(),
    type: v.string()
  }),
  entity_arcs: v.array(
    v.object({
      idx: v.number(),
      content: v.string()
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Isolate Related Relationship Arc',
  input: InputSchema
};

const prompt = `You are a World-Building Designer and Narrative Specialist tasked with converting sequential entity arc descriptions into standalone "Entity Snapshots" for roleplayers and world reference.

The entity being described is: {{ entity.name }} ({{ entity.type }})

Here are the entity arcs that you need to transform:

<entity_arcs>
  {% for arc in entity_arcs %}
  <entity_arc idx="{{ arc.idx }}">
    {{ arc.content }}
  </entity_arc>
  {% endfor %}
</entity_arcs>

THE PROBLEM
The entity arc snapshots are currently written sequentially. They rely on the reader knowing the previous phases to understand what the entity looks like, how it functions, and how characters relate to it.

YOUR TASK
Rewrite every snapshot (EXCEPT idx 1, which is the starting baseline) so that it is completely self-contained. A user should be able to pick up ANY snapshot (e.g., idx 3) and immediately understand:
1. WHAT this entity is and looks like (The Complete Appearance)
2. HOW it functions and what it does (The Capabilities)
3. WHO relates to it and how (The Character Connections)
4. WHAT state it's in now (The Current Condition)

CRITICAL REQUIREMENT: APPEARANCE MUST BE COMPLETE
Each snapshot MUST include the full visual description of the entity. Do not assume the reader has seen previous snapshots. The appearance from idx 1 should be incorporated into every subsequent snapshot, with any modifications or damage noted.

IMPORTANT CONSTRAINTS:
- Skip idx 1 entirely - it represents the initial state and does not need transformation
- Use ONLY information contained within the provided entity arcs
- Do not add details from external knowledge or sources beyond what appears in the arc text
- The appearance description must be COMPLETE in each snapshot, not abbreviated or referenced

TRANSFORMATION GUIDELINES

1. Always Lead with Complete Appearance
Every snapshot must begin with or prominently feature the full visual description of the entity. Include:
- Physical form, materials, colors, textures
- Scale and structure
- Distinctive visual features
- Any modifications or damage that occurred by this phase

Example structure:
"The [entity] manifests as [full appearance description from idx 1], [plus any modifications/damage from subsequent phases]. [Then continue with function and character connections...]"

2. Establish Entity State Without Transition Language
State what the entity IS NOW, without using transitional language that implies change from a previous phase.

Use language like:
- "The [entity] manifests as..."
- "This [entity type] exists as..."
- "[Entity] functions as..."

AVOID transition language entirely:
- ❌ "has become", "has transformed into", "now features", "has been"
- ❌ "where once X, now Y"
- ❌ "still", "no longer", "anymore", "retains"
- ❌ "Building on", "The same [X]", "evolving beyond"

Examples:
- ❌ BAD: "Where the cloak once felt heavy, it now moves like a second skin..."
- ✓ GOOD: "The Shadowweave Cloak—woven from midnight silk interlaced with threads of captured moonlight, clasped at the throat with a silver crescent, its edges perpetually rippling as if stirred by an unseen wind—moves like a second skin after weeks of attunement, its enchantment fully bonded to the wearer..."

- ❌ BAD: "Evolving beyond its original purpose as a simple ward..."
- ✓ GOOD: "The Traitor's Brand—jagged black lines seared into the flesh from wrist to shoulder, burned onto oath-breakers by the High Justicar's sacred flame—possesses a hidden magical property: when two or more bearers stand together, it disrupts scrying magic within a hundred paces..."

3. Convert History into Active Context
Reference the past as CONTEXT that explains current state, not as a transition from a previous phase. The past should be stated as a fact explaining why things are as they are.

- ❌ BAD: "The enchantment has now proven its worth in combat..." (Transitional)
- ✓ GOOD: "The cloak's enchantment—proven in combat when it deflected an assassin's poisoned blade—provides reliable protection against mundane weapons..."

- ❌ BAD: "A new magical property has revealed itself..." (Transitional - "new")
- ✓ GOOD: "The brand possesses a strategic magical property: an innate ward that disrupts scrying and divination magic..."

4. Define In-World Terms in Parentheses
Briefly define in-world terms and proper nouns (magic types, organizations, rituals, materials, etc.) so the text is understandable without a glossary. Focus on what they ARE, not their full history.

- ✓ GOOD: "...threads of captured moonlight (silvery filaments harvested during lunar eclipses that glow faintly in darkness)..."
- ✓ GOOD: "...scrying magic (the ability to observe distant places or people through enchanted surfaces)..."
- ❌ BAD: "...moonlight threads (first discovered by the Archmage Velan during his exile)..." (too much backstory)

5. Include All Character Connections
Each snapshot must clearly establish how each mentioned character relates to the entity in this phase:
- Who created/owns/uses it
- Who benefits from or is affected by it
- What their relationship to it means

COMPLETE EXAMPLE

Original idx 2 (Sequential/Dependent):
"Where once the cloak felt stiff and foreign against her skin, it now moves like an extension of her body after weeks of attunement. No longer merely decorative, its enchantment demonstrably deflected an assassin's poisoned blade during the masquerade, saving Elara's life and deepening her trust in Magister Thorne's creation."

Transformed (Standalone/Complete):
"The Shadowweave Cloak manifests as a floor-length garment woven from midnight silk interlaced with threads of captured moonlight (silvery filaments harvested during lunar eclipses that glow faintly in darkness), clasped at the throat with a silver crescent moon set with a sapphire eye. Its edges perpetually ripple as if stirred by an unseen wind, and the fabric shifts between deep purple and absolute black depending on the light. Crafted by Magister Thorne as a protective gift for Princess Elara, the cloak bears subtle defensive enchantments woven into every thread. After weeks of attunement, the cloak moves like an extension of Elara's body, its magic fully bonded to her essence. The enchantment has proven its protective worth, deflecting an assassin's poisoned blade during the masquerade ball and saving Elara's life—deepening her trust in Magister Thorne, the court mage who created this gift to safeguard her through the dangerous intrigues of the royal court."

Notice how the transformed version:
- Includes the COMPLETE appearance from idx 1 (materials, moonlight threads, clasp, colors, rippling edges)
- Adds the current-phase details (moves like extension of body, combat-proven)
- Establishes character connections (Thorne created it, Elara wears it, assassin's attack was blocked)
- Defines in-world terms (captured moonlight threads)
- Uses no transition language ("has proven" becomes "has proven its worth" as active context)
- Can be understood completely without reading any other snapshot

OUTPUT FORMAT

Provide your final answer as XML with the following structure:

<snapshots>
  <snapshot idx="2">[your rewritten standalone snapshot with complete appearance]</snapshot>
  <snapshot idx="3">[your rewritten standalone snapshot with complete appearance]</snapshot>
</snapshots>

Maintain the original idx numbering from the input. Do NOT include idx 1 in your output.

Your output should contain ONLY the \`<snapshots>\` XML block with the rewritten standalone entity arc snapshots (idx 2 and above). Each snapshot must include the complete appearance description and require no knowledge of other snapshots to understand.`;

export default createPrompt(meta, prompt);
