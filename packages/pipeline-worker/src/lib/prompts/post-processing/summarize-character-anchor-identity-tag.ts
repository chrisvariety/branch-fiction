import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  character: v.object({
    name: v.string(),
    relationships: v.array(v.string())
  })
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Summarize Character Anchor Identity Tag',
  input: InputSchema
};

const prompt = `You will be creating a short "Identity Tag" for a main character. This tag must capture the character's role and core identity in a single, concise sentence.

Here is the character's name:

<character_name>
{{ character.name }}
</character_name>

Here are the character's relationships and actions throughout the story, formatted as graph edges showing who does what to whom:

<relationships>
{% for rel in character.relationships %}
{{ rel }}
{% endfor %}
</relationships>

Your task is to create a brief identity tag that follows this structure:

1. START with the character's role, title, occupation, or species (e.g., "Captain of the Guard", "Potions master", "Rebel princess", "Loyal servant", "Ancient dragon")
2. END with their defining struggle—the ongoing challenge they face throughout their journey

When identifying the defining struggle, read across all the relationships to find the persistent thread:
- **Core tension**: What fundamental obstacle or conflict follows this character? What are they constantly fighting against or striving toward?
- **Key actions**: What does this character DO throughout the story? What verbs define their journey?
- **Open-ended framing**: Use present participles (struggling, fighting, seeking, proving) to capture an ongoing journey rather than a completed one

The identity tag should reflect who this character is at their core—their essential nature and the struggle that defines them—without implying how their story ends.

The identity tag should be:
- A single sentence or phrase
- Concise (typically 5-10 words)
- Focused on the most essential aspects of the character's identity
- Framed as an ongoing journey, not a destination

Here are examples of well-formed identity tags:
- "Runaway princess hiding her magic while posing as a servant."
- "Orphaned thief plotting to rescue her kidnapped brother."
- "Disgraced knight fighting to clear her family's name."
- "Cursed prince searching for the witch who can break his spell."
- "Ambitious squire striving to prove herself against stronger rivals."

Your final output should be in XML format with the following structure:

<identity_tag>Runaway princess hiding her magic while posing as a servant.</identity_tag>`;

export default createPrompt(meta, prompt);
