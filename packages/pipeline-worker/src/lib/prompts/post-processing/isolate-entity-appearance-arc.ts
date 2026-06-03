import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  appearance_arcs: v.array(
    v.object({
      idx: v.number(),
      content: v.string()
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Isolate Entity Appearance Arc',
  input: InputSchema
};

const prompt = `You are a Lead Environment Artist and World-Building Designer tasked with converting sequential appearance descriptions into standalone "Appearance Snapshots" for artists and world reference.

Here are the appearance arcs that you need to transform:

<appearance_arcs>
  {% for arc in appearance_arcs %}
  <appearance_arc idx="{{ arc.idx }}">
    {{ arc.content }}
  </appearance_arc>
  {% endfor %}
</appearance_arcs>

THE PROBLEM
The appearance arc snapshots are currently written sequentially. They rely on the reader knowing the previous phases to understand what the entity looks like now.

YOUR TASK
Rewrite every snapshot (EXCEPT idx 1, which is the starting baseline) so that it is completely self-contained. A user should be able to pick up ANY snapshot (e.g., idx 3) and immediately understand:
1. WHAT this entity is (The Entity Baseline).
2. HOW it got its current features (The Context/History).
3. WHAT state it's in (The Condition).

IMPORTANT CONSTRAINTS:
- Skip idx 1 entirely - it represents the initial state and does not need transformation
- Use ONLY information contained within the provided appearance arcs
- Do not add details from external knowledge or sources beyond what appears in the arc text
- Focus on VISUAL appearance - avoid backstory details unless directly relevant to describing what something looks like

TRANSFORMATION GUIDELINES

1. Establish Entity State Without Transition Language
State what the entity IS NOW, without using transitional language that implies change from a previous phase.

Use language like:
- "A [description] that [current state]..."
- "This [entity type] exists as..."
- "[Entity physical state] defines its current form..."

AVOID transition language entirely:
- ❌ "has become", "has transformed into", "now features", "has been"
- ❌ "where once X, now Y"
- ❌ "still", "no longer", "anymore", "retains"
- ❌ "Building on", "The same [X]"

Examples:
- ❌ BAD: "The same towering fortress now scarred by siege..."
- ✓ GOOD: "A towering fortress of dark granite rising 200 feet above the plains, its western wall bearing massive scorch marks and crumbling sections—damage sustained during the three-month siege by the Ember Legion..."

- ❌ BAD: "Building on the prior state, the blade now pulses with darker energy..."
- ✓ GOOD: "A longsword of black iron with a blade that pulses with dark crimson energy, corrupted after being plunged into the heart of the Shadow Wyrm..."

- ❌ BAD: "Retaining its original form but now overgrown..."
- ✓ GOOD: "An ancient stone archway standing 30 feet tall, its weathered gray surface completely covered in creeping thornvines—wild growth that took hold after the temple's abandonment..."

2. Convert History into Active Context
Reference the past as CONTEXT that explains distinctive features, not as a transition from a previous phase. The past should be stated as a fact explaining current appearance.

- ❌ BAD: "The eastern tower has collapsed..." (Missing context)
- ✓ GOOD: "The eastern tower lies in rubble, collapsed during the dragon attack that devastated the castle's defenses..."

- ❌ BAD: "A new barrier of light surrounds the sanctuary." (Transitional - "new")
- ✓ GOOD: "A shimmering barrier of golden light surrounds the sanctuary, erected by the last remaining priests to protect the sacred relics within..."

- ❌ BAD: "The crystal now glows with unstable energy..." (Transitional)
- ✓ GOOD: "The crystal pulses with unstable violet energy, destabilized when it absorbed the archmage's dying spell..."

3. Keep Definitions Visual and Minimal
When in-world terms appear, provide brief VISUAL descriptions in parentheses, not detailed backstory or lore. Focus on what the thing looks like or what it is materially, not its full history or origin.

- ✓ GOOD: "...built from starcrystal (polished opalescent material that shifts color)..."
- ✓ GOOD: "...light-bridges (shimmering translucent walkways)..."
- ✓ GOOD: "...anchor stones (waist-high enchanted obelisks)..."
- ❌ BAD: "...starcrystal (harvested from the Celestial Mines by the ancient order)..." (too much backstory)
- ❌ BAD: "...anchor stones (placed by the founding mages during the first ritual)..." (focus on what they look like, not who placed them)

4. Weave Together Visual Elements
Create a complete visual portrait by integrating scale/shape/structure, materials/textures/condition, color palette/light sources, distinctive features with their origins, and environmental context. Make it vivid and immersive.

COMPLETE EXAMPLE

Original (Sequential/Dependent):
"Building on the prior state, the observatory's eastern spires have collapsed entirely, leaving jagged stumps of fractured crystal. The light-bridges now flicker weakly, unstable and dangerous."

Transformed (Standalone/Contextualized):
"A damaged floating structure hovering above the clouds, diminished with visible gaps where sections have fallen away. The structure is built from starcrystal (a polished, opalescent material that shifts color with light), though much of it is fractured and dull. Three eastern spires have collapsed entirely, destroyed during the Celestial War when enemy mages breached the defenses, leaving jagged stumps with sharp crystal edges jutting into the sky. The elegant light-bridges connecting platforms flicker intermittently, pulsing weakly between solid and ethereal states—their magic failing without the anchor stones (enchanted obelisks that once stabilized the structure's levitation magic). The massive central dome bears a massive fissure running from apex to base, cracked open when the observatory's power core was damaged in the attack. Inside, a colossal brass orrery continues its perpetual motion, though several celestial bodies have fallen and lie shattered on the crystalline floor. The western garden platforms tilt at dangerous angles, their magically-sustained greenery charred and lifeless after the fires. The once-iridescent whites and pale blues of the crystal have dulled to cloudy gray in damaged sections, and the ambient starlight that once illuminated the structure flickers weakly, leaving many areas in shadow. The visual mood is melancholic and ominous—a dying sanctuary where ancient knowledge slips away into darkness."

Notice how the transformed version:
- Establishes the entity state without transitional language ("is built from" not "was built", "flicker" not "now flicker")
- Provides context as active explanation (Celestial War, damaged power core) not as a transition
- Defines in-world terms (starcrystal, anchor stones) in parentheses
- Weaves all visual details together into a complete portrait
- Can be understood completely without reading any other snapshot

OUTPUT FORMAT

Provide your final answer as XML with the following structure:

<snapshots>
  <snapshot idx="2">[your rewritten standalone appearance snapshot]</snapshot>
  <snapshot idx="3">[your rewritten standalone appearance snapshot]</snapshot>
</snapshots>

Maintain the original idx numbering from the input. Do NOT include idx 1 in your output.

Your output should contain ONLY the \`<snapshots>\` XML block with the rewritten standalone appearance snapshots (idx 2 and above). Each snapshot should be a complete, self-contained description that requires no knowledge of other snapshots to understand.`;

export default createPrompt(meta, prompt);
