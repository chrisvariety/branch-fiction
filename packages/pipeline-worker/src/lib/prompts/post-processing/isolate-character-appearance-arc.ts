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
  name: 'Isolate Character Appearance Arc',
  input: InputSchema
};

const prompt = `You are a Narrative Designer tasked with converting sequential appearance descriptions into standalone "Appearance Snapshots" for roleplayers and character reference.

Here are the appearance arcs that you need to transform:

<appearance_arcs>
  {% for arc in appearance_arcs %}
  <appearance_arc idx="{{ arc.idx }}">
    {{ arc.content }}
  </appearance_arc>
  {% endfor %}
</appearance_arcs>

THE PROBLEM
The appearance arc snapshots are currently written sequentially. They rely on the reader knowing the previous phases to understand what the character looks like now.

YOUR TASK
Rewrite every snapshot (EXCEPT idx 1, which is the starting baseline) so that it is completely self-contained. A user should be able to pick up ANY snapshot (e.g., idx 3) and immediately understand:
1. WHAT this character looks like (The Appearance Baseline).
2. HOW they got distinctive features (The Context/History).
3. WHAT their appearance signifies (The Meaning).

IMPORTANT CONSTRAINTS:
- Skip idx 1 entirely - it represents the initial state and does not need transformation
- Use ONLY information contained within the provided appearance arcs
- Do not add details from external knowledge or sources beyond what appears in the arc text
- Focus on VISUAL appearance - avoid backstory details unless directly relevant to describing what something looks like

TRANSFORMATION GUIDELINES

1. Establish Appearance Without Transition Language
State what the character looks like NOW, without using transitional language that implies change from a previous phase.

Use language like:
- "A [description] with [distinctive features]..."
- "This [character] appears as..."
- "[Character physical state] defines their appearance..."

AVOID transition language entirely:
- ❌ "has become", "has transformed into", "now has", "has grown"
- ❌ "where once X, now Y"
- ❌ "still", "no longer", "anymore", "retains"
- ❌ "Building on", "The same [X]"

Examples:
- ❌ BAD: "The same broad-shouldered man now transformed by..."
- ✓ GOOD: "A tall, broad-shouldered man in his late twenties with a weathered face, distinguished by the frost-white streak in his dark hair—a mark left by his elemental bonding ritual..."

- ❌ BAD: "Building on the prior form, her raven-black hair has been..."
- ✓ GOOD: "Her raven-black hair (streaked with silver from channeling storm magic) is cropped short above her ears..."

- ❌ BAD: "Retaining the battle scars (now partially healed..."
- ✓ GOOD: "Her face bears old battle scars—three parallel claw marks across her left cheek, partially faded but still visible from her encounter with the shadow beast..."

2. Convert History into Active Context
Reference the past as CONTEXT that explains distinctive features, not as a transition from a previous phase. The past should be stated as a fact explaining current appearance.

- ❌ BAD: "Her eyes have turned molten gold..." (Transitional)
- ✓ GOOD: "Her eyes are molten gold, transformed by the dragon pact she forged to gain her powers..."

- ❌ BAD: "A new guild brand marks her forearm." (Missing context)
- ✓ GOOD: "A guild brand marks her forearm, burned into her skin during her initiation into the Iron Vanguard mercenary company..."

- ❌ BAD: "She now wears the gray cloak of a Warden initiate..." (Transitional)
- ✓ GOOD: "She wears the simple gray cloak of a Warden initiate, marking her current status as a trainee in the northern watchtower garrison..."

3. Keep Definitions Visual and Minimal
When in-world terms appear, provide brief VISUAL descriptions in parentheses, not detailed backstory or lore. Focus on what the thing looks like or what it is, not its full history or origin.

- ✓ GOOD: "...a bonding mark (mystical tattoo-like sigil) across her shoulder..."
- ✓ GOOD: "...her combat leathers (reinforced black jacket and pants)..."
- ✓ GOOD: "...an enchanted amulet (silver pendant with glowing blue stone)..."
- ❌ BAD: "...a bonding mark (signifying her pact with the fire spirit Azura, forged in the temple)..." (too much backstory)
- ❌ BAD: "...a vest (crafted by her mentor from enchanted beast scales)..." (focus on appearance, not who made it)

4. Weave Together Physical Elements
Create a complete visual portrait by integrating core physical attributes, distinctive marks/transformations with their origins, current clothing/accessories with their significance, and any temporary states.

COMPLETE EXAMPLE

Original (Sequential/Dependent):
"Building on the prior form, her raven-black hair has been drastically cut to a choppy bob ending at the jaw, wild strands falling across storm-gray eyes now flecked with amber. A new permanent mark adorns her: a spiraling tattoo wrapping her left forearm."

Transformed (Standalone/Contextualized):
"A lean, athletic woman in her early twenties standing at 5'7" with the toned build of a trained fighter—narrow shoulders, wiry arms corded with muscle, and calloused hands bearing the marks of sword work. Her raven-black hair, streaked with silver threads, is cut into a choppy bob ending at the jaw, wild strands falling across storm-gray eyes flecked with amber. Her angular face has sun-darkened olive skin, a sharp nose, and thin lips often pressed into a determined line. A spiraling tattoo wraps her left forearm from wrist to elbow, its enchanted lines glowing faintly with pale blue light. She wears practical traveling leathers (dark reinforced jacket and pants) over a dark green tunic, a curved short sword at her hip, and soft-soled boots suited for silent movement."

Notice how the transformed version:
- Establishes her appearance without transitional language ("Building on" and "now" removed)
- Provides a complete visual portrait without requiring knowledge of previous snapshots
- Keeps definitions minimal and appearance-focused (traveling leathers defined simply)
- Weaves all physical details together into a standalone description
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
