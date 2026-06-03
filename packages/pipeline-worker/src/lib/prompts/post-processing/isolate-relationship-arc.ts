import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  relationship_arcs: v.array(
    v.object({
      idx: v.number(),
      content: v.string()
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Isolate Relationship Arc',
  input: InputSchema
};

const prompt = `You are a Narrative Designer tasked with converting sequential story analysis into standalone "Scenario Primers" for roleplayers.

Here are the relationship arcs that you need to transform:

<relationship_arcs>
  {% for arc in relationship_arcs %}
  <relationship_arc idx="{{ arc.idx }}">
    {{ arc.content }}
  </relationship_arc>
  {% endfor %}
</relationship_arcs>

THE PROBLEM
The relationship arc snapshots are currently written sequentially. They rely on the reader knowing the previous phases to understand the emotional stakes.

YOUR TASK
Rewrite every snapshot (EXCEPT idx 1, which is the starting baseline) so that it is completely self-contained. A user should be able to pick up ANY snapshot (e.g., Phase 3) and immediately understand:
1. WHO these people are to each other (The Relationship Baseline).
2. WHAT is happening right now (The Current Conflict).
3. WHY it matters (The Context/Definitions).

IMPORTANT CONSTRAINTS:
- Skip idx 1 entirely - it represents the initial state and does not need transformation
- Use ONLY information contained within the provided relationship arcs and character descriptions
- Do not add details from external knowledge or sources beyond what appears in the input data

TRANSFORMATION GUIDELINES

1. Establish the "Relationship Baseline" First
State BOTH what they fundamentally are to each other AND the current emotional state, without using transitional language that implies change from a previous phase.

Use language like:
- "A [current state] defines their relationship..."
- "These [relationship type] navigate a dynamic characterized by..."
- "Their bond exists as..."

AVOID transition verbs entirely:
- ❌ "has evolved into", "has thawed into", "has shifted to", "has become"
- ❌ "where once X, now Y"
- ❌ "still" (implies continuation from previous phase)
- ❌ "no longer", "anymore"

Examples:
- BAD: "The trust between them has collapsed." (Transitional - implies we know it was different before)
- BAD: "She still resents him for the betrayal." ("Still" implies previous knowledge)
- GOOD: "Shattered trust defines their bond—these former allies now maintain a cold distance, their shared history of battlefield loyalty destroyed by his secret treaty with the enemy kingdom."

2. Convert "Transitional History" into "Active Context"
Reference the past as CONTEXT that explains the present, not as a transition from a previous phase. The past should be stated as a fact, not as something that "was" different.

- BAD: "Where once there was trust, now there is suspicion." (Sequential dependency)
- GOOD: "Suspicion characterizes every interaction between these former confidants, their earlier trust destroyed by..."
- BAD: "Following the betrayal..." (Implies reading previous phase)
- GOOD: "A recent betrayal regarding [specific event] has left them estranged..."
- BAD: "Their love has evolved into resentment." (Transitional)
- GOOD: "Resentment poisons the air between these former lovers, their romantic history now a weapon..."

3. Define In-World Terms in Parentheses
Briefly define in-world terms and proper nouns (magic types, organizations, rituals, etc.) so the text is understandable without a glossary.
- Example: "...his storm magic (a rare elemental gift that allows him to summon lightning and wind)..."

4. Maintain the "In the Room" Vibe
Keep the evocative, present-tense, immersive description. Focus on the immediate physical and emotional tension.

COMPLETE EXAMPLE
Original (Sequential/Dependent):
"Following the revelation, the love they built is gone. He begs for forgiveness, but she refuses to look at him, remembering how he lied about the treaty."

Transformed (Standalone/Contextualized):
"Cold estrangement defines the relationship between these former lovers—the profound romantic bond they once shared obliterated by his deception regarding the treaty (a secret peace pact with the enemy kingdom that he concealed from her for months). He begs for forgiveness while she refuses to meet his eyes, her heart hardened by the discovery of lies from the man she once trusted without question. The air between them crackles with the tension of his desperate attempts to bridge the distance and her resolute rejection, their shared history of intimacy now a source of pain rather than comfort."

OUTPUT FORMAT

Provide your final answer as XML with the following structure:

<snapshots>
  <snapshot idx="2">[your rewritten standalone snapshot]</snapshot>
  <snapshot idx="3">[your rewritten standalone snapshot]</snapshot>
</snapshots>

Maintain the original idx numbering from the input. Do NOT include idx 1 in your output.

Your output should contain ONLY the \`<snapshots>\` XML block with the rewritten standalone relationship snapshots (idx 2 and above). Each snapshot should be a complete, self-contained description that requires no knowledge of other snapshots to understand.`;

export default createPrompt(meta, prompt);
