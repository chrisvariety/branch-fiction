import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  place_arcs: v.array(
    v.object({
      idx: v.number(),
      content: v.string()
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Isolate Place Arc',
  input: InputSchema
};

const prompt = `You are a World-Building Designer tasked with converting sequential location descriptions into standalone "Setting Snapshots" for roleplayers and scenario generators.

Here are the location arcs that you need to transform:

<location_arcs>
  {% for arc in place_arcs %}
  <location_arc idx="{{ arc.idx }}">
    {{ arc.content }}
  </location_arc>
  {% endfor %}
</location_arcs>

THE PROBLEM
The location arc snapshots are currently written sequentially. They rely on the reader knowing the previous phases to understand the current state.

YOUR TASK
Rewrite every snapshot (EXCEPT idx 1, which is the starting baseline) so that it is completely self-contained. A user should be able to pick up ANY snapshot (e.g., idx 3) and immediately understand:
1. WHAT this location is (The Setting Baseline).
2. WHAT happens here (The Dynamics).
3. WHY it's this way (The Context/History).

IMPORTANT CONSTRAINTS:
- Skip idx 1 entirely - it represents the initial state and does not need transformation
- Use ONLY information contained within the provided location arcs
- Do not add details from external knowledge or sources beyond what appears in the arc text
- Focus on SETTING and DYNAMICS - what the place looks/feels like and what happens there

TRANSFORMATION GUIDELINES

1. Establish Current State Without Transition Language
State BOTH what the location physically is AND its current purpose/atmosphere, without using transitional language that implies change from a previous phase.

Use language like:
- "A [description] that serves as..."
- "This [location type] functions as..."
- "[Location name] exists as..."

AVOID transition language entirely:
- ❌ "has become", "has evolved into", "has transformed into", "now serves as"
- ❌ "where once X, now Y"
- ❌ "still", "no longer", "anymore", "retains"
- ❌ "Building on", "The same [X]"

Examples:
- ❌ BAD: "The same training grounds, now abandoned after the siege..."
- ✓ GOOD: "A desolate training ground with cracked stone floors and weather-worn wooden posts, abandoned since the devastating siege three months prior when the northern army breached the walls..."

- ❌ BAD: "Where once merchants gathered, now soldiers patrol..."
- ✓ GOOD: "A cobblestone marketplace commandeered by the city guard, where armed soldiers in steel plate patrol between empty merchant stalls—the bustling trade hub converted to a military checkpoint after martial law was declared..."

- ❌ BAD: "The hall retains its grandeur but has taken on a darker purpose..."
- ✓ GOOD: "A vast ceremonial hall with soaring vaulted ceilings and ornate marble columns serving as an interrogation chamber for suspected traitors since the Council's purge began..."

2. Convert History into Active Context
Reference the past as CONTEXT that explains the present, not as a transition from a previous phase. The past should be stated as a fact explaining current conditions.

- ❌ BAD: "The temple is now in ruins..." (Transitional)
- ✓ GOOD: "A ruined temple with collapsed archways and scorched stone walls, devastated during the dragon attack that claimed the high priestess and drove the order into exile..."

- ❌ BAD: "The tavern has become a refuge..." (Implies we knew what it was before)
- ✓ GOOD: "A dim, smoke-filled tavern called the Copper Flagon that serves as a covert meeting place for the resistance, its back room concealed behind a false wine rack—a sanctuary established after the rebellion's headquarters was raided..."

3. Keep Definitions Concise and Functional
When in-world terms appear, provide brief functional descriptions in parentheses. Focus on what/where the thing is, not extensive historical details.

- ✓ GOOD: "...the Sanctum (the sacred bonding chamber)..."
- ✓ GOOD: "...the battle of Stonegate Pass (a failed defense three weeks prior)..."
- ✓ GOOD: "...the Copper Flagon (a dim tavern)..."
- ❌ BAD: "...the Sanctum (built by the founding priestesses in the year 412 using ancient rituals)..." (too much history)
- ❌ BAD: "...Stonegate Pass (a strategic mountain crossing controlled by the kingdom since the First War)..." (excessive lore)

4. Weave Together SETTING and DYNAMICS
Ground the reader in SENSORY details (sight, sound, smell, temperature), then layer in the SOCIAL meaning (what happens here, who comes, what tensions exist). Be SPECIFIC about who inhabits these moments—use character names, not vague terms.

Examples:
- "The smithy is a sweltering workspace lit by forge fires, where the master blacksmith Theron hammers out weapons for the coming war while his apprentices whisper anxiously about the draft notices..."
- "The moonlit garden provides an illicit meeting ground, where forbidden lovers Elara and Kian steal moments beneath the willow tree, their whispered conversations punctuated by nervous glances toward the palace windows..."

COMPLETE EXAMPLE

Original (Sequential/Dependent):
"Where training once dominated, now grief pervades. The same grounds where they sparred have become a memorial."

Transformed (Standalone/Contextualized):
"An outdoor training ground of packed earth surrounded by wooden practice dummies and weapon racks, serving as an impromptu memorial site. Makeshift shrines dot the perimeter—flowers, weapons, and personal tokens laid at the bases of the training posts—commemorating the warrior-trainees lost in the battle of Stonegate Pass (a failed defense three weeks prior that claimed half the company). The atmosphere is heavy with loss, particularly in the early mornings when Commander Lyra comes alone to stand before the dummy her fallen partner Gareth used for practice, her silent vigil a ritual the remaining soldiers respect by keeping their distance. The clang of practice swords has been replaced by the whisper of wind through memorial ribbons, and those who pass through do so quietly, the weight of recent sacrifice palpable in every corner."

Notice how the transformed version:
- Establishes what the location IS without transitional language ("serving as" not "has become")
- Provides context as active explanation (battle of Stonegate Pass) not as a transition
- Names specific characters (Commander Lyra, Gareth) rather than vague terms
- Weaves SETTING (physical details, sensory atmosphere) with DYNAMICS (who comes, what they do, how they behave)
- Defines in-world terms (Stonegate Pass battle) in parentheses
- Can be understood completely without reading any other snapshot

OUTPUT FORMAT

Provide your final answer as XML with the following structure:

<snapshots>
  <snapshot idx="2">[your rewritten standalone location snapshot]</snapshot>
  <snapshot idx="3">[your rewritten standalone location snapshot]</snapshot>
</snapshots>

Maintain the original idx numbering from the input. Do NOT include idx 1 in your output.

Your output should contain ONLY the \`<snapshots>\` XML block with the rewritten standalone location snapshots (idx 2 and above). Each snapshot should be a complete, self-contained description that requires no knowledge of other snapshots to understand.`;

export default createPrompt(meta, prompt);
