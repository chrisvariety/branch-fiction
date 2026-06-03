import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  entries: v.array(
    v.object({
      entityId: v.string(),
      entityLabel: v.string(),
      entityDescription: v.string(),
      name: v.string(),
      matchCount: v.number(),
      passages: v.array(v.string())
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Flag Overmatching Entity Names',
  input: InputSchema
};

const prompt = `You will review a small set of (entity, name) pairs from a novel. Each name has produced a statistically unusual number of plain-text matches in the book. Your job is to decide which ones are so generic that they refer to a wide-open set of subjects rather than to any identifiable group of entities.

CONTEXT FOR YOUR DECISION

Each name is used downstream as an exact-string search term against the book's text. When a match is found, downstream code pairs it with a disambiguation phrase (the entity's full label), so each name does NOT need to be globally unique. It does not even need to map to a single entity — a name like "Mom" mapping to a small set of mothers in the book, or "the Captain" mapping to a handful of captains, is good to KEEP. Downstream disambiguation handles small ambiguities like that.

What we are catching here are names whose matches are scattered across an OPEN-ENDED, indefinite set of unrelated subjects — pronouns, articles, or extremely common nouns that happen to overlap with an entity's label and would balloon the mention count with noise.

For each entry you will see:
- The entity's label and description (who/what the name is supposed to refer to).
- The candidate name itself.
- A count of how many times this name appears in the book.
- A sample of passages where it appears, with surrounding context.

DECISION RULE

- FLAG the name only if the sampled passages clearly show it being used for a wide, open-ended range of unrelated subjects — i.e. the name is a function word or generic with no consistent referent.
- KEEP the name if the passages plausibly refer to the entity OR to a small handful of similar entities (a few moms, a few guards), OR if you cannot tell, OR if the name carries any distinguishing content (descriptor, role, kinship, proper noun, world-specific term).
- When in doubt, KEEP. Removing a meaningful name is far worse than keeping a borderline one. A name that maps to three or four similar people is still a useful search term; only flag names that map to "anyone and anything."

ENTRIES

<entries>
{% for entry in entries %}
  <entry id="{{ entry.entityId }}">
    <entity-label>{{ entry.entityLabel }}</entity-label>
    <entity-description>{{ entry.entityDescription }}</entity-description>
    <candidate-name>{{ entry.name }}</candidate-name>
    <match-count>{{ entry.matchCount }}</match-count>
    <passages>
    {% for passage in entry.passages %}
      <passage>{{ passage }}</passage>
    {% endfor %}
    </passages>
  </entry>
{% endfor %}
</entries>

OUTPUT FORMAT

Reply with a single <flagged> block listing only the (entity, name) pairs that should be removed. Use the entity id and name verbatim. Do not include any text outside the <flagged> block.

<flagged>
  <pair id="ent_1" name="he" />
  <pair id="ent_5" name="the" />
</flagged>

If nothing should be flagged, return an empty <flagged /> element. In practice, most entries will be kept — that is the expected outcome.`;

export default createPrompt(meta, prompt);
