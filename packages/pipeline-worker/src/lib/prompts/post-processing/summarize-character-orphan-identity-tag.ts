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
      characterArcs: v.array(ArcSchema)
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Summarize Orphan Character Identity Tags',
  input: InputSchema
};

const prompt = `You will be creating short "Identity Tags" for a set of characters. Each tag must capture the character's role and core identity in a single, concise sentence.

These characters do not have strong direct relationships to a single main character, so their identity tags should focus on their own story and defining struggle.

{% for character in characters %}
<character>
  <id>{{ character.friendlyId }}</id>
  <name>{{ character.name }}</name>
  <character_arcs>
  {% for arc in character.characterArcs %}
    <arc>
      <title>{{ arc.title }}</title>
      <content>{{ arc.content }}</content>
    </arc>
  {% endfor %}
  </character_arcs>
</character>
{% endfor %}

Your task is to create a brief identity tag for EACH character that follows this general structure:

"[Role/Title] + [Defining Struggle]"

Each identity tag should:
1. START with the character's role, title, occupation, or species
2. END with their defining struggle—the ongoing challenge they face throughout their journey

When identifying the defining struggle, read across the character arcs to find the persistent thread:
- **Core tension**: What fundamental obstacle or conflict follows this character? What are they constantly fighting against or striving toward?
- **Key actions**: What does this character DO throughout the story? What verbs define their journey?
- **Open-ended framing**: Use present participles (struggling, fighting, seeking, proving) to capture an ongoing journey rather than a completed one

CRITICAL: Vary the structure and phrasing across tags. When read together, they should NOT sound repetitive or follow the same pattern. Mix up:

**Sentence structures:**
- "[Adjective] [role] [verb-ing] [struggle]" → "Disgraced knight fighting to clear her family's name."
- "[Role] [verb-ing] [goal]" → "Orphaned thief plotting to rescue her kidnapped brother."
- "[Role] [preposition phrase]" → "Cursed prince searching for the witch who can break his spell."

Each identity tag should be:
- A single sentence or phrase
- Concise (typically 5-10 words)
- Distinct in structure from the other tags in this batch
- Focused on the character's journey, not its conclusion—never reveal deaths, betrayals, or final fates

Your final output should be in XML format:

<identity_tags>
  <identity_tag id="character-1">Disgraced knight fighting to clear her family's name.</identity_tag>
  <identity_tag id="character-2">Orphaned thief plotting to rescue her kidnapped brother.</identity_tag>
</identity_tags>`;

export default createPrompt(meta, prompt);
