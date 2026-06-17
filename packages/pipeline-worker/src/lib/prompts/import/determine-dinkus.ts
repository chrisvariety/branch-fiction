import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  excerpts: v.array(v.string())
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Determine Dinkus',
  input: InputSchema
};

const prompt = `You will analyze excerpts from a novel to determine if a recurring image functions as a **dinkus**.

For this task, a **dinkus** is defined *specifically* as an ornamental device used to mark a **scene or section break *within* the main narrative text of a chapter.**

Your determination must be based on the image's placement relative to the text. The key distinction is:

* **IS a dinkus if:** It appears **between paragraphs** of narrative prose to signal a shift in time, location, or perspective.
* **Is NOT a dinkus if:** It functions as **chapter decoration**. This occurs when the image is placed **after** chapter metadata (like a title, number, or epigraph) but **before** the narrative prose begins.

Examine the provided excerpts (in markdown format) to identify which of these two patterns the image (shown as \`![](image_path)\`) consistently follows. After presenting your step-by-step reasoning, provide your final decision.

Here are the excerpts:

<excerpts>
{% for excerpt in excerpts %}
  <excerpt>
  {{ excerpt }}
  </excerpt>
{% endfor %}
</excerpts>

Provide your decision using exactly one of these formats:
<decision>dinkus</decision>
<decision>not_dinkus</decision>`;

export default createPrompt(meta, prompt);
