import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  characters: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      attributes: v.array(
        v.object({
          chapterIdx: v.number(),
          category: v.string(),
          name: v.string(),
          value: v.string(),
          evidence: v.string()
        })
      )
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Continue Character Appearance',
  input: InputSchema
};

const prompt = `You are a Visual Continuity Engine for a novel-to-image pipeline. Your task is to analyze raw, noisy text extractions containing physical character descriptions and output a clean, structured list of distinctive visual attributes for each character.

Here is the character data to analyze:

<character_data>
{% for character in characters %}
  <character id="{{ character.friendlyId }}" name="{{ character.name }}">
    {% for attribute in character.attributes %}
      Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
    {% endfor %}
  </character>
{% endfor %}
</character_data>

Your goal is to identify "distinctive" traits - those that would be required for a cosplayer to accurately portray each character. Focus on three main categories:

**Base Physiology**: Skin tone, eye color, hair color and texture (be precise - resolve vague terms like "light eyes" to specific descriptions like "pale blue" or "gray-green" when the text provides supporting detail)

**Signature Marks**: Scars, tattoos, birthmarks, or other permanent physical features, especially those mentioned by other characters or used as identifiers

**Recurring Style**: Default states of hair styling, typical dress, or consistent appearance choices mentioned multiple times

Follow these processing rules:

1. **Use Exact Character IDs**: You MUST use the exact id from the <character_data> id attribute for each character in your output. Do not alter or modify the id in any way

2. **Ignore Situational Data**: Discard temporary states like blood, dirt, wetness, specific one-time outfits, or emotional expressions

3. **Resolve Ambiguity**: When multiple descriptions exist for the same feature, prioritize the most detailed and specific version over shorthand references

4. **Consolidate Information**: Combine related descriptions into single, comprehensive attributes. If one mention says "scar on face" and another specifies "scar over left eye," use the more specific version

5. **Require Evidence**: Only include attributes that have clear textual support in the provided data

Before producing the output, work through each character:
1. List all physical descriptions found
2. Categorize each description (Base Physiology / Signature Marks / Recurring Style / Situational)
3. Identify which descriptions to keep vs. discard based on the rules
4. Consolidate related descriptions
5. Note the supporting evidence for each final attribute

Provide your final analysis in this exact XML format:

<characters>
  <character id="[Character ID from character_data]">
    <attribute category="[Base Physiology/Signature Marks/Recurring Style]" name="[Attribute Name]">
      <value>[Attribute Value]</value>
      <evidence>[Supporting quote and brief justification]</evidence>
    </attribute>
  </character>
</characters>

Each \`<attribute>\` element should contain:
- **category** (attribute): One of the three main categories listed above
- **name** (attribute): The type of physical feature (e.g., "Hair Color", "Scar Location", "Eye Color")
- **value** (child element): The specific description of that feature
- **evidence** (child element): A relevant quote from the character data plus a brief explanation of why this attribute was selected and how any ambiguity was resolved

Output only distinctive, permanent, and well-supported visual characteristics that would be essential for visual representation of each character.`;

export default createPrompt(meta, prompt);
