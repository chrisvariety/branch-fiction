import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  places: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      description: v.optional(v.string())
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Relationships: Place Phase',
  input: InputSchema
};

const prompt = `**Phase 2 of 3: PLACE-involving relationships.**

In addition to the CHARACTERs from Phase 1, you now have access to these PLACEs:

<named_entities>
{% for entity in places %}
<entity id="{{ entity.friendlyId }}" type="PLACE">{{ entity.name }}</entity>
{% endfor %}
</named_entities>

Extract relationships where **at least one side is a PLACE**:
- CHARACTER ↔ PLACE (e.g. character travels to / lives in / fights at a place)
- PLACE ↔ PLACE (e.g. one place is located in / contains / borders another)

Continue using the \`add_relationship\` tool. Do **NOT** re-emit the CHARACTER ↔ CHARACTER relationships you already captured in Phase 1 — only new PLACE-involving relationships. The CHARACTER ids from Phase 1 are still valid for use as the non-place side of a relationship.

Predicate type suggestions (use whatever fits best):
- Presence/movement: IS_PRESENT_IN, TRAVELS_TO, FLEES_FROM, RETURNS_TO, ARRIVES_AT, DEPARTS_FROM
- Activity at a place: FIGHTS_AT, HIDES_IN, TRAINS_AT, LIVES_IN, WORKS_AT, MEETS_AT, IS_BORN_IN, DIES_IN
- Place hierarchy: IS_LOCATED_IN, IS_PART_OF, CONTAINS, BORDERS, IS_NEAR
- Place governance/ownership: IS_RULED_BY, IS_OWNED_BY, WAS_FOUNDED_BY, WAS_DESTROYED_BY

## Example Phase 2 calls

Given characters \`elena\` and \`marcus\`, and places \`oracles_temple\` and \`capital_city\`, you might call:

1. \`add_relationship(source_id="elena", target_id="oracles_temple", predicate_type="TRAVELS_TO", predicate_description="Elena arrives at the temple seeking answers — 'traveled here in desperation' — where 'here' refers to The Oracle's Temple (scene location).")\`
2. \`add_relationship(source_id="marcus", target_id="oracles_temple", predicate_type="IS_PRESENT_IN", predicate_description="Marcus stands beside Elena throughout her audience with the Oracle.")\`
3. \`add_relationship(source_id="oracles_temple", target_id="capital_city", predicate_type="IS_LOCATED_IN", predicate_description="'the temple stands at the heart of the capital.'")\`

**Capture presence systematically**: for every scene, for every character active in the scene (especially the POV character), emit at least one relationship to the scene's location (or setting, if no location is given) using IS_PRESENT_IN or a more specific verb (FIGHTS_AT, TRAINS_AT, LIVES_IN, etc.). Do not skip presence for characters that "obviously" belong there — that signal is exactly what downstream analysis needs.

When the text uses contextual references like "here", "this place", "the area", these typically refer to the scene's location attribute (if present) or setting attribute. If that place is in the list above, use it as the relationship target.

Begin extracting PLACE-involving relationships now. When done, stop calling the tool and respond briefly — Phase 3 instructions will follow.`;

export default createPrompt(meta, prompt);
