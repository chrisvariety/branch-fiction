import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  character: v.object({
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
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Determine Minors (Follow-up)',
  input: InputSchema
};

const prompt = `Next character to analyze:

<character id="{{character.friendlyId}}" name="{{character.name}}">
  {% for attribute in character.attributes %}
  Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
  {% endfor %}
</character>

Classify using the same rules as before. Reuse what you've already learned about this book's roles, cohorts, and named characters from earlier turns — only call tools if this character needs context you haven't already established. Emit one \`<minor-status>\` block.`;

export default createPrompt(meta, prompt);
