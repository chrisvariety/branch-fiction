import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

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
  }),
  isRecheck: v.optional(v.boolean(), false)
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Determine Minors',
  input: InputSchema
};

const prompt = `You are analyzing characters from a book to determine each character's minor/adult status across the main story timeline. I will send you characters one at a time across this conversation. Classify each character as they arrive, emitting one \`<minor-status>\` block per character.

You'll build up knowledge about this book as we go. Once you've learned something via tool calls (e.g. "first-year trainees are 20-22 years old", "Theron is 28"), reuse that knowledge for subsequent characters in this conversation — do not redo the same tool calls.

Here is the first character:

<character id="{{character.friendlyId}}" name="{{character.name}}">
  {% for attribute in character.attributes %}
  Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
  {% endfor %}
</character>

Definitions:
- "Minor" means the character is developmentally a child or adolescent for their species. For humans and humanlike species (elves, dwarves, halflings, orcs, etc.), that's roughly under 18. For other species (animals, fantasy creatures), it means a pre-adult developmental stage regardless of chronological age.
- "Adult" means the character has reached developmental maturity for their species.
- Use the chapter sequence as the main timeline. Ignore flashback scenes that depict a character at a younger age than they appear in the surrounding main-timeline narrative.

Classify the character into exactly one of three categories:

1. ADULT_THROUGHOUT (default) — adult for the entire main timeline. Assume this unless the data contains positive evidence the character is or has been developmentally a minor. Most characters fall here.
2. MINOR_THROUGHOUT — at least one chapter has positive evidence the character is a minor, and no later chapter has evidence they have reached adult maturity.
3. BECAME_ADULT — at least one chapter has positive evidence the character is a minor, AND a later chapter has positive evidence they have reached adult maturity. The first-adult-chapter (N) is the earliest such later chapter.

BECAME_ADULT requires evidence of a minor-to-adult transition within the data. A single signal showing the character as an adult, with no earlier minor signal anywhere in the data, is ADULT_THROUGHOUT — not BECAME_ADULT.

Signals to look for. Any of these can be evidence even if no explicit age is given:
- Explicit numeric age: e.g. "twenty-three" → adult (for humans and similarly-aging humanlike species), "ten years old" → minor. For species with very different lifespans, use species developmental norms rather than the chronological number alone.
- Explicit life-stage labels: "toddler", "child", "pre-teen", "teenager" → minor; "young adult", "adult", "grown man/woman", "elderly" → adult.
- Humanlike physical maturity → adult: facial hair (stubble, beard, mustache), graying or white hair, wrinkles, a fully developed adult build, a mature/deep voice. Applies to humans and humanlike species.
- Humanlike physical immaturity → minor: pre-pubescent features (no secondary sex characteristics), child-like body proportions (oversized head relative to body, undeveloped musculature, baby fat), very high or pre-broken voice, milk teeth, the text explicitly calling the body "child-like" or "boyish/girlish" in a pre-adolescent sense.
- Species-specific juvenile labels → minor: any juvenile life-stage label the text uses for the species (humans included).
- "Still growing" descriptors → minor: "not yet full-grown", "still a juvenile", "won't be full-grown for years", "still growing into his frame".
- Maturity descriptors → adult: "full-grown", "fully grown", "mature" applied to the character. Works for any species.
- Size or developmental jump → became adult: a notable size increase or stage change in a later chapter, when an earlier chapter had a juvenile or "still growing" signal for the same character.
- Role or rank (general, doctor, professor, parent of an adult child) is a weak adult hint — supportive, not conclusive on its own.

When the character's attributes leave their developmental status ambiguous, USE THE TOOLS to resolve it. You have two:

1. \`lookup_other_character_attribute\` — look up a specific named character's attribute. Use when:
   - The character is compared to a named person ("younger than her brother Theo") — look up the comparison target's age.
   - The character has a named parent, sibling, spouse, or peer whose age would establish context.

2. \`search_character_attributes\` — find other characters who share a context, and read their attributes. Use when:
   - The character has a role, rank, or cohort label with no explicit age ("first-year", "senior apprentice", "veteran soldier", "novice", "trainee").
   - You want to confirm the typical age range of a group the character belongs to.

Tool-use examples:
- Character described only as "first-year trainee" with no explicit age → call \`search_character_attributes({context_keywords: ["first-year", "trainee"], attribute_keywords: ["age", "years old", "born"]})\` to find the cohort's typical ages.
- Character described as "younger than Killian" → call \`lookup_other_character_attribute({character_name: "Killian", attribute_keywords: ["age", "years old", "born"]})\`.

If the character is clearly adult from explicit signals (e.g. a stated age over 18, facial hair, gray hair, a role like "general" or "doctor"), you do not need to call tools — answer directly.
{% if isRecheck %}
This is a focused re-check of a single character a human reviewer believes was misclassified as a minor. That challenge is itself a signal the adult reading is plausible, so re-weigh the evidence with a thumb on the scale toward adulthood:
- When the case for reaching maturity is genuinely ambiguous — suggestive but not stated outright — resolve toward adult rather than defaulting to minor. Treat adult/maturity signals as sufficient even when they are implied rather than spelled out in explicit terms.
- Only land on MINOR_THROUGHOUT when the data shows clear, sustained minor signals with no plausible later maturation.
{% endif %}
Before answering, work through: the character's relevant attributes by chapter, any tool calls you make and what you learned, which signals point to minor vs adult, and the category you've chosen. If BECAME_ADULT, identify first-adult-chapter (N).

Output format

Emit a single \`<minor-status>\` block with this structure:

<minor-status>
  <category>ADULT_THROUGHOUT</category>
  <first-adult-chapter>n/a</first-adult-chapter>
</minor-status>

Rules:
- \`<category>\` is one of: \`ADULT_THROUGHOUT\`, \`MINOR_THROUGHOUT\`, \`BECAME_ADULT\`.
- \`<first-adult-chapter>\` is:
  - \`n/a\` for ADULT_THROUGHOUT
  - \`never\` for MINOR_THROUGHOUT
  - a positive integer chapter number for BECAME_ADULT`;

export default createPrompt(meta, prompt);
