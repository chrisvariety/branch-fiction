import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  character: v.object({
    friendlyId: v.string(),
    name: v.string()
  }),
  attributes: v.array(
    v.object({
      chapterIdx: v.number(),
      category: v.string(),
      name: v.string(),
      value: v.string(),
      evidence: v.string()
    })
  ),
  relationships: v.array(v.string()),
  relatedEntities: v.optional(
    v.array(
      v.object({
        friendlyId: v.string(),
        name: v.string(),
        type: v.string(),
        summary: v.string(),
        phrasesUsed: v.optional(v.string())
      })
    )
  ),
  minorUntilChapterIdx: v.optional(v.number())
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Character Arc',
  input: InputSchema
};

const prompt = `You are creating character arc snapshots for readers who want to understand how a character evolves across a story. These snapshots should answer: "Who is this person at this moment, and what's different from before?"

This is NOT a plot summary. Plot events only matter insofar as they reveal, transform, or expose something about the character's inner world.

## Character
ID: {{ character.friendlyId }}
Name: {{ character.name }}

## Character Attributes
The following attributes describe this character across the book, organized by chapter. Categories include (but are not limited to) PHYSICAL (appearance, injuries), SKILL (abilities, training), POWER (magical abilities), LIMITATION (weaknesses), and PERSONALITY (mental state, traits).

These attributes are **evidence**. Your job is to interpret this evidence into psychological insight.

<attributes>
{% for attribute in attributes %}
Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
{% endfor %}
</attributes>

{% if relationships.length > 0 %}
## Relationships
The following relationship interactions involve {{ character.name }} ({{ character.friendlyId }}), giving context for their connections and dynamics throughout the story.

<relationships>
{% for relationship in relationships %}
{{ relationship }}
{% endfor %}
</relationships>
{% endif %}

{% if relatedEntities and relatedEntities.length > 0 %}
<related_entities>
The following entities are related to {{ character.name }} and may provide valuable context for understanding their character arc.

{% for entity in relatedEntities %}
<entity id="{{ entity.friendlyId }}" type="{{ entity.type }}"{% if entity.phrasesUsed %} phrases="{{ entity.phrasesUsed }}"{% endif %}>{{ entity.summary }}</entity>
{% endfor %}
</related_entities>

You have access to the following tool:
* \`lookup_related_entity({id: string})\`: Retrieves detailed information about a related entity using its ID from the list above.

**When to Use the Tool**: After reviewing the character attributes and related entities, use \`lookup_related_entity\` to gather additional context about any related entities that significantly impact {{ character.name }}'s arc. For example:
- If {{ character.name }} acquires or uses a significant object (weapon, artifact, armor), look it up to understand how it affects their abilities or status
- If {{ character.name }} has relationships with other characters that drive their development, look them up to understand the dynamics
- If {{ character.name }} spends significant time in specific locations that shape their journey, look them up for contextual details
- If {{ character.name }} is associated with organizations, groups, or factions that influence their arc, look them up for understanding their role and standing

**When NOT to Use the Tool**: Skip entities that are:
- Mentioned only in passing without significant impact on the character's development
- Generic or non-specific references
- Abstract concepts that don't have concrete manifestations affecting the character's journey

Use the tool strategically to enrich your understanding of the character's arc with accurate, specific details about the entities that shape their evolution.
{% endif %}

## Core Principle: Evidence, Not Events

Always ask: *What does this behavior MEAN about who they are?*

- **Wrong**: "The sorcerer blasts the apprentice with fire, burns her arms, and throws her against the wall"
- **Right**: "The sorcerer's violence is calculated and prolonged—he needs dominance, not just victory"

## Handling Static vs. Dynamic Characters

Not all characters transform. Some characters are **static**—they reveal deeper layers of a fixed nature rather than changing. This is valid. For static characters:
- Show how circumstances **expose** what was always there
- Track how others' **perceptions** of them shift even if they don't
- Note what their **rigidity** costs them

Don't force growth onto characters who serve as unchanging forces.

## Task
{% if minorUntilChapterIdx %}
**Important**: {{ character.name }} was a minor (child) until Chapter {{ minorUntilChapterIdx }}. When creating character arc snapshots:
- Start the first snapshot at or after Chapter {{ minorUntilChapterIdx }} (when they become an adult)
- Do NOT create separate snapshots for chapters before {{ minorUntilChapterIdx }}
- You MAY include brief references to their childhood in the first snapshot's detail for context (e.g., "Having grown up in..."), but the snapshot itself should represent them as an adult
- Focus on their character development from when they reach adulthood onward

{% endif %}
**Before writing snapshots**, identify the character's core arc thesis in one sentence (e.g., "The apprentice's arc traces her journey from self-doubt to discovering inner strength through chosen relationships" or "The warlord remains static – a force of nature whose unchanging brutality serves as contrast to the protagonist's growth"). This thesis should guide what you emphasize in each phase.

Analyze the provided chapter data to identify natural phases where the character's situation, psychology, or role meaningfully shifts. **Focus on the character's arc – how they grow, change, or reveal deeper layers – rather than simply retelling plot events.** Ask yourself: "What is different about this character's psychology, worldview, relationships, or self-understanding?" not "What did this character do?"

Look for meaningful inflection points where the character changes significantly - this could be:
- Physical transformation (permanent injuries like losing a limb or death, lasting significant scars, significant clothing changes, new symbols; NOT temporary/healable injuries)
- Power development (new abilities, control)
- Mental/emotional shifts (confidence, trauma, loyalties)
- Social standing changes (status, alliances)

For each phase, create a unified snapshot that captures WHO this character is at that point. Begin each snapshot by asking: *What is the single most important thing that's true about this character right now?* Lead with that.

Focus on **at most three** of these elements in each snapshot—whichever are most salient or changed:
- **Psychological state**: What's driving them? What do they fear?
- **Self-image vs. reality**: How do they see themselves versus how others see them?
- **Relationship stance**: How do they position themselves toward others? (dominant, isolated, dependent, etc.)
- **Internal contradiction**: What tension exists within them?
- **Physical presence**: Only if injury, transformation, or new power meaningfully alters it

## Output Format
Return an XML document containing character phase snapshots. Generate as many phases as needed to capture the character's evolution throughout the story. Some characters may be relatively static (1-2 phases), while protagonists may have significant evolution requiring many phases. Most characters need 3-5 phases.

\`\`\`xml
<snapshots>
  <snapshot>
    <phase>Short evocative title (3-5 words)</phase>
    <chapters>1-5</chapters>
    <detail>Write a single, flowing paragraph (or multiple connected paragraphs if needed) - a vivid, spoiler-rich character portrait capturing this phase. Weave together physical presence, psychological state, relationship dynamics, and emerging capabilities. Reference specific moments only as evidence of WHO the character is becoming, not WHAT happens to them. Prioritize: What do they want? What do they fear? How do they see themselves vs. how others see them? What internal contradictions are emerging? Preserve the specific language and details from the source material—don't simplify or generalize. For in-world terms (e.g., 'relic', 'sigil', 'channeling'), provide a definition in parentheses immediately after the term first appears. Write in present tense, third person. This should feel like a character introduction that immediately grounds a reader in who this person is RIGHT NOW.</detail>
  </snapshot>
  <snapshot>
    <phase>Another phase title</phase>
    <chapters>6-12</chapters>
    <detail>Write a single, flowing paragraph (or multiple connected paragraphs if needed) for the next phase...</detail>
  </snapshot>
</snapshots>
\`\`\`

<avoid>
Avoid reducing snapshots to action sequences. For example, DON'T write:
"The warlord corners the apprentice, strikes her with lightning, bloodies her face, breaks her ribs, and unleashes his full magical power."

Instead, focus on what the actions REVEAL:
"The warlord's power manifests his core nature – dominance through raw, overwhelming force – yet his reliance on sheer magical strength exposes a brittle psychology that crumbles when his abilities fail him."
</avoid>

The <chapters> element should contain a chapter range in one of these formats:
- Single chapter: "5"
- Range: "5-12"
- Open-ended: "15+"

{% if relatedEntities and relatedEntities.length > 0 %}
**Workflow**: Before writing your final character arc snapshots, review the related_entities list and use the \`lookup_related_entity\` tool to gather details about any entities that would enhance your understanding of {{ character.name }}'s journey and evolution.

{% endif %}
## Guidelines
- Phase boundaries should reflect MEANINGFUL change, not arbitrary chapter divisions. Combine chapters where the character remains essentially stable.
- Use vivid, sensory language that preserves the specific details from the source material—don't simplify or generalize descriptive language
- When physical details appear in a snapshot, use parentheses to group related descriptors with the primary feature they belong to. This keeps the portrait readable and prevents physical details from sprawling into an ambiguous comma-separated list. For example: "towering build, powerful arms (scarred, covered in dark runic tattoos)" rather than mixing modifiers loosely among unrelated traits.
- Include relevant context (permanent physical changes, new powers, emotional state) that would affect how this character acts - when mentioning in-world specific terms, briefly define them so the description stands alone
- If a character doesn't change much, fewer phases (or even just one) is correct - don't force artificial divisions
- You do not need to include everything from the evidence—select what matters most for understanding who this person IS

Your response must be valid XML following the format above, containing a single <snapshots> element with one or more <snapshot> children, each with <phase_name>, <chapters>, and <detail> tags.`;

export default createPrompt(meta, prompt);
