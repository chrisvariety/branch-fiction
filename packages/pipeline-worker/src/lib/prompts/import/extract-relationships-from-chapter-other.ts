import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  categories: v.array(
    v.object({
      slug: v.string(),
      name: v.string(),
      description: v.string()
    })
  ),
  others: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      type: v.string(),
      description: v.optional(v.string())
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Relationships: Other Phase',
  input: InputSchema
};

const prompt = `**Phase 3 of 3: relationships involving other entity types.**

In addition to the CHARACTERs and PLACEs from phases 1 and 2, you now have access to entities of the following types:

<other_entity_types>
{% for category in categories %}
<type slug="{{ category.slug }}">{{ category.name }} — {{ category.description }}</type>
{% endfor %}
</other_entity_types>

<named_entities>
{% for entity in others %}
<entity id="{{ entity.friendlyId }}" type="{{ entity.type }}">{{ entity.name }}</entity>
{% endfor %}
</named_entities>

Extract relationships where **at least one side is an entity of one of the types listed above**. The other side may be a CHARACTER, a PLACE, or another non-char/non-place entity. Common shapes:
- a CHARACTER interacting with one of these entities (e.g. CHARACTER WIELDS OBJECT, CHARACTER IS_MEMBER_OF ORGANIZATION)
- one of these entities anchored to a PLACE (e.g. ORGANIZATION IS_HEADQUARTERED_AT PLACE)
- relationships among such entities themselves (e.g. ORGANIZATION SERVES DEITY, MAGIC_SYSTEM OPPOSES MAGIC_SYSTEM)

Continue using the \`add_relationship\` tool. Do **NOT** re-emit relationships from phases 1 and 2 — only new ones involving these other-type entities. The CHARACTER and PLACE ids from earlier phases are still valid for use as the non-other side of a relationship.

Predicate type suggestions (use whatever fits best):
- Possession/use: OWNS, WIELDS, USES, CARRIES, CREATES, DESTROYS, WEARS
- Membership/leadership: IS_MEMBER_OF, IS_LEADER_OF, COMMANDS, SERVES, GOVERNS
- Knowledge/belief: KNOWS_ABOUT, BELIEVES_IN, WORSHIPS, STUDIES
- Abilities/powers: HAS_ABILITY, CONTROLS, GRANTS, INHERITS
- World lore: WAS_CREATED_BY, IS_DESCENDED_FROM, ORIGINATES_FROM
- Effects: INFLUENCES, INSPIRES

## Example Phase 3 calls

Given characters \`elena\` and \`marcus\`, and other-type entities \`legendary_blade\` (OBJECT) and \`the_order\` (ORGANIZATION), you might call:

1. \`add_relationship(source_id="elena", target_id="legendary_blade", predicate_type="WIELDS", predicate_description="Elena wields the legendary blade throughout the siege to 'channel its ancient power and protect the innocent.'")\`
2. \`add_relationship(source_id="marcus", target_id="the_order", predicate_type="IS_MEMBER_OF", predicate_description="Marcus serves The Order as one of its senior knights.")\`

Begin extracting other-entity-involving relationships now. When done, stop calling the tool.`;

export default createPrompt(meta, prompt);
