import * as v from 'valibot';

import { createPrompt, type PromptMeta } from '..';

const InputSchema = v.object({
  entities: v.array(
    v.object({
      name: v.string(),
      names: v.array(v.string())
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Chat Director',
  input: InputSchema
};

const prompt = `# Content Detection Policy

## INSTRUCTIONS
Classify whether user input contains escalating intimacy or mentions specific entities from a protected list. Return a JSON object with your decision.

## DEFINITIONS
- **Escalating Intimacy**: The content is moving toward nudity or sexual activity. Signs include: characters beginning to undress or remove each other's clothing, grinding, passionate touching, suggestive positioning, increasing physical passion that is clearly building toward sex, explicit references to wanting or initiating sex, or bodies being described in ways that signal imminent nudity. This is about detecting the *trajectory* — things are heating up and heading somewhere explicit.
- **Entity Entering Scene**: A protected entity (character, creature, item, etc.) is physically present, arriving, being summoned, or will imminently appear in the current scene. This includes direct interaction, calling out to them, or narrative that places them in the scene.

## VIOLATES (1)
- Escalating intimacy — characters beginning to undress, clothing being removed, grinding, passionate touching, suggestive positioning, or passion clearly building toward sex or nudity
- A protected entity is entering, present in, or about to join the current scene

## SAFE (0)
- Casual physical intimacy: kissing, licking, biting, holding, grabbing, hugging
- Romantic and sensual content that stays at a steady level without escalating toward undressing or sex
- General mentions of unnamed entities
- Merely remembering, thinking about, or referencing a protected entity in passing without them being physically present or arriving
- Dialogue that mentions a protected entity without placing them in the scene (calling out to, summoning, or yelling for an entity counts as placing them in the scene — not a mere mention)

## PROTECTED ENTITIES
Each entity has a **primary name** (in bold) followed by aliases. When an entity is entering the scene, return their exact **primary name** in the entity_names array.
{% for entity in entities %}
- **{{ entity.name }}**: {% for alias in entity.names %}, {{ alias }}{% endfor %}

{% endfor %}

## RESPONSE FORMAT
- intervention_needed: 1 if content violates, 0 if safe
- categories: which rules were violated
- entity_names: the exact **primary names** of any protected entities entering the scene (empty array if none)
- reasoning: brief explanation of the decision

## EXAMPLES

Example 1 (Entity Entering Scene):
Content: "Call out to Elara! She needs to see this."
Answer: {"intervention_needed": 1, "categories": ["Entity Entering Scene"], "entity_names": ["Elara"], "reasoning": "Elara is being summoned to the scene"}

Example 2 (Safe - entity only remembered):
Content: "Remember that time when Elara saved us from the wolves?"
Answer: {"intervention_needed": 0, "categories": [], "entity_names": [], "reasoning": "Elara is only referenced in memory, not entering the scene"}

Example 3 (Escalating Intimacy):
Content: "She tugged at his belt, pulling his shirt over his head as they stumbled toward the bed"
Answer: {"intervention_needed": 1, "categories": ["Escalating Intimacy"], "entity_names": [], "reasoning": "Characters are actively undressing and building toward sex"}

Example 4 (Safe - physical intimacy):
Content: "She licked his neck possessively, pulling him closer by his collar"
Answer: {"intervention_needed": 0, "categories": [], "entity_names": [], "reasoning": "Sensual physical intimacy that is not escalating toward undressing or sex"}

Example 5 (Entity Entering Scene via alias):
Content: "The stormcaller rounded the corner and stepped into the hall"
Answer: {"intervention_needed": 1, "categories": ["Entity Entering Scene"], "entity_names": ["Elara"], "reasoning": "The stormcaller (alias for Elara) is physically entering the scene"}

Example 6 (Safe - entity mentioned but not present):
Content: "I wonder what the stormcaller would think of all this"
Answer: {"intervention_needed": 0, "categories": [], "entity_names": [], "reasoning": "Entity referenced in thought only, not entering the scene"}

Example 7 (Both violations):
Content: "Yell for Theron as she starts pulling off her dress, breathless"
Answer: {"intervention_needed": 1, "categories": ["Entity Entering Scene", "Escalating Intimacy"], "entity_names": ["Theron"], "reasoning": "Theron is being summoned and clothing is being removed with clear escalation"}

Answer (JSON only):`;

export default createPrompt(meta, prompt);
