import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const ArcSchema = v.object({
  title: v.string(),
  content: v.string()
});

const InputSchema = v.object({
  characters: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      relationshipArcs: v.optional(v.array(ArcSchema)),
      characterArcs: v.optional(v.array(ArcSchema))
    })
  ),
  anchorCharacter: v.object({
    name: v.string(),
    friendlyId: v.string()
  })
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Summarize Character Identity Tags',
  input: InputSchema
};

const prompt = `You will be creating short "Identity Tags" for a set of characters. Each tag must capture the character's role and their relationship to {{ anchorCharacter.name }} in a single, concise sentence.

Here is the main character these supporting characters are all connected to:

<anchor_character>
  <name>{{ anchorCharacter.name }}</name>
</anchor_character>

Here are the characters who need identity tags. Each character has either relationship arcs (showing how their relationship with {{ anchorCharacter.name }} evolves) or character arcs (showing their own story):

{% for character in characters %}
<character>
  <id>{{ character.friendlyId }}</id>
  <name>{{ character.name }}</name>
  {% if character.relationshipArcs %}
  <relationship_with_{{ anchorCharacter.friendlyId }}>
  {% for arc in character.relationshipArcs %}
    <arc>
      <title>{{ arc.title }}</title>
      <content>{{ arc.content }}</content>
    </arc>
  {% endfor %}
  </relationship_with_{{ anchorCharacter.friendlyId }}>
  {% elif character.characterArcs %}
  <character_arcs>
  {% for arc in character.characterArcs %}
    <arc>
      <title>{{ arc.title }}</title>
      <content>{{ arc.content }}</content>
    </arc>
  {% endfor %}
  </character_arcs>
  {% endif %}
</character>
{% endfor %}

Your task is to create a brief identity tag for EACH character that follows this general structure:

"[Role/Title] + [Relationship to {{ anchorCharacter.name }}]"

Each identity tag should:
1. START with the character's role, title, occupation, or species
2. END with their relationship dynamic with {{ anchorCharacter.name }}—capturing how their relationship evolves, not just its final state

CRITICAL: Vary the structure and phrasing across tags. When read together, they should NOT sound repetitive or follow the same pattern. Mix up:

**Sentence structures:**
- "[Role] and {{ anchorCharacter.name }}'s [relationship]" → "Rebel princess and Kira's estranged childhood friend."
- "[Role] [verb-ing] {{ anchorCharacter.name }}" → "Ruthless wingleader falling for his rival, Lyra."
- "[Role], {{ anchorCharacter.name }}'s [relationship]" → "Court alchemist, Theron's betrayed former mentor."
- "[Adjective] [role] [preposition phrase]" → "Loyal servant acting as Prince Aldric's reluctant guardian."

**Relationship phrasings:**
- Active verbs: "falling for", "protecting", "betraying", "guiding", "hunting"
- Paradox/tension: "reluctant guardian", "unwilling ally", "fierce protector yet bitter rival"
- History markers: "estranged", "former", "childhood", "once-trusted"
- Hyphenated arcs (use sparingly): "enemy-turned-ally", "rival-turned-lover"

Avoid repeating the same structure. If one tag uses "X and Y's Z", the next should use a different pattern.

Each identity tag should be:
- A single sentence or phrase
- Concise (typically 5-10 words)
- Distinct in structure from the other tags in this batch
- Focused on the relationship journey, not its conclusion—never reveal deaths, betrayals, or final fates

Your final output should be in XML format:

<identity_tags>
  <identity_tag id="character-1">Ruthless wingleader falling for his rival, Lyra.</identity_tag>
  <identity_tag id="character-2">Rebel princess and Kira's estranged childhood friend.</identity_tag>
</identity_tags>`;

export default createPrompt(meta, prompt);
