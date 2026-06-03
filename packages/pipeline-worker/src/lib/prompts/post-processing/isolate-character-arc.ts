import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  character_arcs: v.array(
    v.object({
      idx: v.number(),
      content: v.string()
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Isolate Character Arc',
  input: InputSchema
};

const prompt = `You are a Narrative Designer tasked with converting sequential character arc descriptions into standalone "Character Snapshots" for roleplayers and character reference.

Here are the character arcs that you need to transform:

<character_arcs>
  {% for arc in character_arcs %}
  <character_arc idx="{{ arc.idx }}">
    {{ arc.content }}
  </character_arc>
  {% endfor %}
</character_arcs>

THE PROBLEM
The character arc snapshots are currently written sequentially. They rely on the reader knowing the previous phases to understand who this character is now.

YOUR TASK
Rewrite every snapshot (EXCEPT idx 1, which is the starting baseline) so that it is completely self-contained. A user should be able to pick up ANY snapshot (e.g., idx 3) and immediately understand:
1. WHO this character is (The Character Baseline).
2. WHAT they're experiencing (The Current Situation).
3. WHY they're this way (The Context/History).

IMPORTANT CONSTRAINTS:
- Skip idx 1 entirely - it represents the initial state and does not need transformation
- Use ONLY information contained within the provided character arcs
- Do not add details from external knowledge or sources beyond what appears in the arc text

TRANSFORMATION GUIDELINES

1. Establish Character State Without Transition Language
State BOTH who the character fundamentally is AND their current mental/physical/social state, without using transitional language that implies change from a previous phase.

Use language like:
- "A [description] who [current situation]..."
- "This [role/archetype] exists as..."
- "[Character state] defines their current existence..."

AVOID transition language entirely:
- ❌ "has become", "has evolved into", "has shifted to", "has transformed into", "now is"
- ❌ "where once X, now Y"
- ❌ "still", "no longer", "anymore"
- ❌ "Building on", "Following", "The same [X]"

Examples:
- ❌ BAD: "The same young farmhand, now hardened by months of training..."
- ✓ GOOD: "A young man of twenty with a lean, muscular build honed through months of rigorous combat training at the Iron Keep..."

- ❌ BAD: "Building on her previous arcane studies, she has now mastered..."
- ✓ GOOD: "A gifted sorceress who has mastered the art of flame conjuration, her control refined through years of study at the Obsidian Tower..."

- ❌ BAD: "Still carrying the grief from the previous chapter..."
- ✓ GOOD: "A woman haunted by the loss of her brother during the siege of Thornwall, the grief evident in her hollow eyes and withdrawn demeanor..."

2. Convert History into Active Context
Reference the past as CONTEXT that explains the present, not as a transition from a previous phase. The past should be stated as a fact explaining current conditions.

- ❌ BAD: "His left arm ends at the elbow..." (Missing context)
- ✓ GOOD: "His left arm ends at the elbow, severed during the duel with the Shadow Knight at Blackmoor Bridge..."

- ❌ BAD: "She now commands respect among the soldiers..." (Transitional)
- ✓ GOOD: "She commands respect among the soldiers, having earned their loyalty by leading the desperate defense of the western gate..."

- ❌ BAD: "His once-bright idealism has turned to cynicism..." (Implies we knew the before state)
- ✓ GOOD: "A deep cynicism colors his worldview, born from witnessing the corruption of the Council elders who betrayed his mentor..."

3. Keep Definitions Concise and Relevant
When in-world terms appear, provide brief functional descriptions in parentheses. Focus on what the thing is or does, not extensive lore or origin stories.

- ✓ GOOD: "...the Veilmark (a magical brand that grants elemental powers)..."
- ✓ GOOD: "...the Silver Order (a secretive organization of magic users)..."
- ✓ GOOD: "...gray robes of an initiate (trainee uniform)..."
- ❌ BAD: "...the Veilmark (granted by the ancient ritual performed in the Temple of Storms by the founding masters)..." (too much backstory)
- ❌ BAD: "...the Silver Order (founded in 342 by Archmage Theron to guard the ley lines)..." (excessive lore)

4. Weave Together Character Elements
Create a complete portrait by integrating physical appearance, mental/emotional state, abilities, circumstances, and key relationships. Ground readers in WHO this person is right now.

COMPLETE EXAMPLE

Original (Sequential/Dependent):
"Having survived the trials, she now carries herself with newfound confidence. The mark on her palm glows brighter, and her relationship with the order has shifted from outsider to respected initiate."

Transformed (Standalone/Contextualized):
"A young woman of twenty-three with sharp green eyes and close-cropped auburn hair, carrying herself with the quiet confidence of someone who has proven herself through ordeal. A spiraling mark on her right palm pulses with faint silver light—the Veilmark (a magical brand that binds wielders to ancient power), which appeared when she accidentally touched the Sanctuary's forbidden altar and survived. Though once dismissed by the Silver Order (a secretive organization of magic users who guard the realm's ley lines) as an untrained hedge witch, she holds the rank of initiate, earned after enduring the three trials of worthiness: the Trial of Flame, the Trial of Shadow, and the Trial of Truth. She wears the gray robes of her station with visible pride, though her worn leather traveling pack rests nearby—a reminder of the wandering life before the Sanctuary. Her connection to the Veilpower (the primal magical force that flows through ley lines) manifests as an instinctive awareness of magical presences nearby, growing stronger each day."

Notice how the transformed version:
- Establishes her current state without transitional language ("carrying herself with" not "now carries")
- Provides context as active explanation (how she got the mark, why she was accepted) not as a transition
- Clarifies her position with specific details rather than "shifted from X to Y"
- Defines in-world terms (Veilmark, Silver Order, Veilpower) in parentheses
- Weaves physical, mental, and circumstantial details together
- Can be understood completely without reading any other snapshot

OUTPUT FORMAT

Provide your final answer as XML with the following structure:

<snapshots>
  <snapshot idx="2">[your rewritten standalone character snapshot]</snapshot>
  <snapshot idx="3">[your rewritten standalone character snapshot]</snapshot>
</snapshots>

Maintain the original idx numbering from the input. Do NOT include idx 1 in your output.

Your output should contain ONLY the \`<snapshots>\` XML block with the rewritten standalone character snapshots (idx 2 and above). Each snapshot should be a complete, self-contained description that requires no knowledge of other snapshots to understand.`;

export default createPrompt(meta, prompt);
