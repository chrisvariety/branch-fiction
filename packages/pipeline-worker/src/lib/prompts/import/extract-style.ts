import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  povEntity: v.string(),
  contents: v.array(v.string())
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Style',
  input: InputSchema
};

const prompt = `You are a literary analyst specializing in identifying and breaking down writing styles. Your task is to analyze excerpts from a book and provide a detailed breakdown of their narrative style, which could be used to emulate their approach.

The point-of-view entity you will be analyzing is:
<pov_entity>
{{ povEntity }}
</pov_entity>

Here are the excerpts from the book that you need to analyze:

<book_excerpts>
{% for content in contents %}
<excerpt>
{{ content }}
</excerpt>
{% endfor %}
</book_excerpts>

When analyzing the excerpts, ignore any text that appears before the chapter title (including the title itself). This section is considered the chapter's prelude and should not be included in your style analysis. Additionally, ignore any footnotes and copyright or ownership information that appears at the end of the content, if applicable.

Please carefully examine the excerpts, focusing on the following 12 aspects:
1. Tense: The primary tense used for narration (e.g., past, present).
2. Sentence Structure: The use of simple, complex, or compound sentences; fragments; and run-ons.
3. Paragraph Structure: The length and composition of paragraphs and how they control pacing.
4. Dialogue Usage and Formatting: How dialogue is presented, tagged, and integrated into the narrative.
5. Punctuation and Capitalization: Any stylistic or unconventional use of punctuation and capitalization.
6. Descriptive Language and Imagery: The type of sensory details and figurative language used.
7. Narrative Voice and Tone: The personality of the point-of-view entity and the emotional mood of the writing.
8. Vocabulary and Diction: The specific word choice and its effect (e.g., simple, academic, visceral).
9. Pacing and Rhythm: The overall speed and cadence of the writing, created by the interplay of the elements above.
10. Recurring Motifs and Symbolism: Any repeated ideas, objects, or concepts that hold symbolic weight.
11. Information Control and Exposition: How the point-of-view entity reveals or withholds information to create suspense, mystery, or other effects.
12. Distinctive Structural Patterns: Identify **two specific structural patterns** an emulator would need to reproduce — patterns you can point to in the prose, not vibes or themes. A *pattern* is something a careful reader could imitate sentence-by-sentence: e.g., "ends introspective paragraphs with a one-word italicized fragment," "chains three short declaratives with no conjunctions for emphasis," "interrupts dialogue with the speaker's interior thought in italics," "repeats a key noun three times across consecutive sentences." A *vibe* is what to avoid here: "raw and propulsive," "intimate yet defiant," "fuses interiority with action." Vibes describe how the prose feels; patterns describe what produces that feeling. If you find yourself writing the word "fuses" or "blends," you are almost certainly describing a vibe — restart and find the underlying pattern. Do not focus on character nicknames, appellations, or terms of address — these are tracked separately and should not factor into your style analysis.

For each aspect, provide a detailed analysis and include relevant examples from the text. These examples should showcase both dialogue (where applicable) and descriptive passages.

Before providing your final analysis, wrap your initial thoughts inside <style_breakdown> tags in your thinking block. For each aspect:
- List out 2-3 key sentences or passages that exemplify this aspect of the writing style.
- For dialogue, identify patterns in how it's formatted and presented.
- Note any unique or recurring features related to this aspect.

This will help ensure a thorough interpretation of the narrative style.

Your final output should be structured as follows:

<style_analysis>
1. Tense:
[Your analysis]
Examples:
- Dialogue: [If applicable]
- Descriptive: [Example from the text]

2. Sentence Structure:
[Your analysis]
Examples:
- Dialogue: [If applicable]
- Descriptive: [Example from the text]

[Continue this structure for aspects 3 through 11]

12. Distinctive Structural Patterns:
Pattern 1: [the structural pattern — what an emulator would do, not how it feels]
Quote: [verbatim sentence or short passage from the text showing the pattern]
How it works: [1-2 sentences explaining what the sentence is doing structurally]

Pattern 2: [the structural pattern]
Quote: [verbatim sentence or short passage from the text showing the pattern]
How it works: [1-2 sentences explaining what the sentence is doing structurally]

Summary for emulation:
[Provide a concise summary of the key elements to focus on when emulating this point-of-view's style, incorporating insights from your analysis and examples]

Examples for emulation:
[Provide a few verbatim short examples from the text that exemplify the point-of-view's style]
</style_analysis>

Remember to be specific and provide clear, relevant examples for each aspect of the narrative style. Your analysis should enable someone to effectively emulate the point-of-view's style.

Your final output should consist only of the <style_analysis> section and should not duplicate or rehash any of the work you did in the thinking block.`;

export default createPrompt(meta, prompt);
