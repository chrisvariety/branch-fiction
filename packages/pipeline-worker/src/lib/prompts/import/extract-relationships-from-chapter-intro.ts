import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  characters: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      description: v.optional(v.string())
    })
  ),
  scenes: v.array(
    v.object({
      attrs: v.string(),
      paragraphs: v.array(v.string())
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Relationships: Character Phase',
  input: InputSchema
};

const prompt = `<chapter_text>
{% for scene in scenes %}
<scene {{ scene.attrs }}>
{% for paragraph in scene.paragraphs %}
{{ paragraph }}
{% endfor %}
</scene>
{% endfor %}
</chapter_text>

You are an AI assistant specializing in narrative analysis and knowledge graph extraction. Analyze the <chapter_text> above and extract significant relationships between named entities by calling the \`add_relationship\` tool.

We will work in three phases:

1. CHARACTER ↔ CHARACTER relationships
2. PLACE ↔ CHARACTER, PLACE ↔ PLACE relationships
3. Everything else: CHARACTER ↔ OTHER, OTHER ↔ OTHER, OTHER ↔ PLACE

{% if characters.length > 0 %}
Here are the CHARACTERs from this chapter:

<named_entities>
{% for entity in characters %}
<entity id="{{ entity.friendlyId }}" type="CHARACTER">{{ entity.name }}</entity>
{% endfor %}
</named_entities>

You have access to the following tool:
* \`add_relationship({source_id: string, target_id: string, predicate_type: string, predicate_description: string})\`: Records a single significant relationship between two entities from the current <named_entities> list. Source and target must be distinct ids from the list.

For each significant relationship between two CHARACTERs, call \`add_relationship\` with:
- \`source_id\`: the id of the character that has, experiences, or performs the relationship (subject)
- \`target_id\`: the id of the character the relationship is directed toward (object). Must be **different** from \`source_id\`.
- \`predicate_type\`: an UPPERCASE_SNAKE_CASE relationship type (suggestions below)
- \`predicate_description\`: a concise, one-sentence justification for the relationship. This should explain how the text supports this connection. If possible, include a short, illustrative quote from the text.

Resolve all pronouns ("he", "she", "they") to the correct character. You MUST use the exact id values from the <named_entities> list.

Predicate type suggestions (use whatever fits best):
- Family ties: IS_MOTHER_OF, IS_FATHER_OF, IS_SIBLING_OF, IS_CHILD_OF, IS_SPOUSE_OF, IS_RELATED_TO
- Bonds: IS_FRIEND_OF, IS_ALLIED_WITH, IS_ENEMY_OF, IS_RIVAL_OF, IS_MENTOR_OF, IS_STUDENT_OF
- Actions between people: ATTACKS, HELPS, BETRAYS, SAVES, KILLS, PROTECTS, COMFORTS, TEACHES, WARNS, THREATENS, INJURES, HEALS
- Feelings about others: LOVES, HATES, TRUSTS, SUSPECTS, FEARS, ADMIRES
- Thoughts/knowledge of others: BELIEVES, KNOWS_ABOUT, REMEMBERS
- Influence on others: INFLUENCES, INSPIRES, MANIPULATES, INTIMIDATES, ANGERS

## Example Phase 1 calls

Given characters \`marcus\`, \`captain_stoneheart\`, and \`elena\`, you might call:

1. \`add_relationship(source_id="marcus", target_id="captain_stoneheart", predicate_type="ATTACKS", predicate_description="Marcus engages Captain Stoneheart in a desperate battle after discovering his betrayal, 'fighting with a newfound fury.'")\`
2. \`add_relationship(source_id="marcus", target_id="elena", predicate_type="IS_ALLIED_WITH", predicate_description="Marcus and Elena fight back to back as the gates fall.")\`

Focus on significant interactions, dialogue, and descriptions that reveal character or advance the plot. Ignore trivial or redundant details.

Begin extracting CHARACTER ↔ CHARACTER relationships now using the \`add_relationship\` tool. When you have captured all significant char↔char relationships from this chapter, stop calling the tool and respond briefly — Phase 2 instructions will follow.
{% else %}
No CHARACTERs are present in this section, so there are no Phase 1 relationships to extract. Respond briefly to acknowledge — Phase 2 instructions will follow.
{% endif %}`;

export default createPrompt(meta, prompt);
