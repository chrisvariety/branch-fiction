import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  povEntity: v.string(),
  passages: v.array(
    v.object({
      n: v.number(),
      content: v.string()
    })
  ),
  selectCount: v.number()
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Select Distinctive Passages',
  input: InputSchema
};

const prompt = `You are a literary analyst selecting passages from a novel that best expose the **structural quirks** of a narrator's writing style — the patterns a downstream analyst would need to see in order to emulate the voice.

The point-of-view entity you are analyzing is:
<pov_entity>
{{ povEntity }}
</pov_entity>

Below are passages from the book, each labeled with a number in \`<passage n="N">\` tags:

<passages>
{% for passage in passages %}
<passage n="{{ passage.n }}">
{{ passage.content }}
</passage>
{% endfor %}
</passages>

## Your Task

Select up to {{ selectCount }} passages. **Prioritize structural distinctiveness over beautiful prose** — passages where the narrator's signature patterns are most visible, not the most elegantly written ones.

You must aim for coverage across these categories. If a category exists in the passages above, at least one of your picks should come from it:

1. **Repetition / parallel structure** — passages with anaphora ("She returned. She always returned."), staccato lists ("Sharp. Sudden. Final."), or any sentence-level repetition used for rhythm or emphasis.
2. **Italicized or fragment-based interior monologue** — single-word italics (\`_No._\`, \`_Run._\`), italicized internal asides interrupting action or dialogue, or one-word sentence fragments used as thought-beats.
3. **Dialogue with characteristic tagging** — passages showing how the narrator tags speech (terse "I say" vs. action beats vs. no tag at all), interrupts dialogue with internal reaction, or blends dialogue with thought.
4. **Reflective / introspective interiority** — slower passages where the narrator processes events, asks themself questions, or pulls inward. These reveal the thinking voice and tense framing.
5. **High-tension action or sensory immediacy** — fast passages with short sentences, sensory bursts, or fight/chase rhythms. These reveal pacing and physicality.
6. **Distinctive vocabulary or world-specific diction** — passages where invented terms, fantasy/world-building language, profanity, or a peculiar word choice appears, especially blended with everyday speech.

Avoid passages that are mostly plot summary, transition, or generic exposition where any narrator could have produced the same words. A short passage with one striking quirk beats a long passage of competent prose.

## Output Format

Your final output must be a single \`<distinct_passages>\` block containing a \`<passage n="N" />\` element for each passage you choose, using the \`n\` value from its \`<passage n="N">\` tag above. Do not include any text outside this block.

<distinct_passages>
  <passage n="[passage number]" />
  <passage n="[passage number]" />
</distinct_passages>

Your final output should consist only of the \`<distinct_passages>\` block.`;

export default createPrompt(meta, prompt);
