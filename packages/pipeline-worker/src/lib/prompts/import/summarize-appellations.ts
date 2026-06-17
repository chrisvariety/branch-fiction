import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  type: v.string(),
  entities: v.array(
    v.object({
      id: v.string(),
      names: v.array(
        v.object({
          name: v.string(),
          count: v.number()
        })
      )
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Summarize Appellations',
  input: InputSchema
};

const prompt = `You will be analyzing {{ type }} data to select the most appropriate primary name for each {{ type }} based on usage frequency while avoiding generic terms and conflicts.

<{{ type }}_data>
{% for entity in entities %}
<{{type}} id="{{ entity.id }}">
  <names>
    {% for name in entity.names %}
    <name count="{{ name.count }}">{{ name.name }}</name>
    {% endfor %}
  </names>
</{{type}}>
{% endfor %}
</{{ type }}_data>

Your task is to select the best primary name for each {{ type }} from their list of alternative names. Each {{ type }} has a unique ID that you must preserve in your output. The best name should be:
1. The most frequently used name (highest count)
2. NOT an overly generic phrase that could refer to multiple {{ type }}s
3. NOT a phrase that refers to a different {{ type }} in the data
4. Distinct across all final selections—if multiple {{ type }}s would end up with the same name, that name is ambiguous for all of them, and each must fall to their next-best option that produces a unique set of selections
5. When a proper name (given name, surname, or full name) is among the candidates, prefer it over kinship terms (e.g., "cousin", "mother"), role/title terms (e.g., "the doctor"), and descriptive epithets (e.g., "the tall stranger") — even when the kinship/role/descriptive term has a higher count.
Overly generic phrases include terms like:
- Family relationships: "mom", "dad", "father", "mother", "sister", "brother", "grandmother", "grandfather", "cousin", "aunt", "uncle", "nephew", "niece", "son", "daughter", "wife", "husband"
- Titles without specific names: "the king", "the queen", "the captain", "the doctor"
- Generic descriptors: "the man", "the woman", "the boy", "the girl"
- Occupational terms: "the baker", "the soldier", "the merchant"

However, if a generic phrase is the ONLY option available for a {{ type }}, then you must use it.

Before producing the output, work through each {{ type }}:
1. {{ type }} ID: record the entity's ID
2. List all alternative names and their counts for this {{ type }}
3. Identify the highest count name(s)
4. Check if the highest count name is overly generic — if so, consider the next highest non-generic option
5. If a proper name is among the candidates, prefer it over kinship/role/descriptive alternatives even when those have higher counts
6. Cross-reference with other {{ type }}s to ensure the chosen name doesn't refer to someone else
7. Make your initial selection and explain your reasoning

Then perform a deduplication pass:
8. Review all selections together — if any two or more {{ type }}s share the same name, revisit each conflicting {{ type }} and choose the highest-count alternative that produces a distinct selection

Your final output should be an XML \`<{{ type }}s>\` block with this exact structure, where each entry includes the entity's ID attribute and the selected name as text content:

<{{ type }}s>
  <{{ type }} id="lyra_stormborn">Primary Name</{{ type }}>
  <{{ type }} id="kaelen">Primary Name</{{ type }}>
</{{ type }}s>

**Important**:
- Each element in your output MUST include the exact ID from the input data as the \`id\` attribute paired with the selected name as the element's text content
- The final output should be only the \`<{{ type }}s>\` XML block, with no surrounding commentary`;

export default createPrompt(meta, prompt);
