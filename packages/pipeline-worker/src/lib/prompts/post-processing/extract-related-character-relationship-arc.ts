import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  entityType: v.string(),
  entities: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      attributes: v.array(
        v.object({
          chapterIdx: v.number(),
          category: v.string(),
          name: v.string(),
          value: v.string(),
          evidence: v.string(),
          source: v.optional(
            v.object({
              friendlyId: v.string(),
              name: v.string(),
              type: v.string(),
              label: v.optional(v.string())
            })
          )
        })
      )
    })
  ),
  characters: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string()
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Entity Arcs',
  input: InputSchema
};

const prompt = `You are analyzing how world elements (objects, magic systems, organizations, etc.) evolve throughout a fantasy novel to create roleplay-ready entity snapshots.

## Entities Being Analyzed
All entities below are of type: {{ entityType }}

<entities>
{% for entity in entities %}
<entity id="{{ entity.friendlyId }}">
  <name>{{ entity.name }}</name>
  <attributes>
{% for attribute in entity.attributes %}
{% if attribute.source %}
    Chapter {{ attribute.chapterIdx }} ({{ attribute.source.label }} {{ attribute.source.name }}, {{ attribute.source.friendlyId }}): {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }}{% if attribute.evidence %} ({{ attribute.evidence }}){% endif %}
{% else %}
    Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }}{% if attribute.evidence %} ({{ attribute.evidence }}){% endif %}
{% endif %}

{% endfor %}
  </attributes>
</entity>
{% endfor %}
</entities>

## Related Characters
The following characters have significant connections to these entities:

<characters>
{% for character in characters %}
<character id="{{ character.friendlyId }}">{{ character.name }}</character>
{% endfor %}
</characters>

## Task
Analyze the relationship and attribute data to create entity arc snapshots that capture how each {{ entityType }} evolves through the story. Consider:

1. **Entity Introduction**: When and how is this entity first introduced? Who creates it, discovers it, or has initial access?
2. **State Changes**: Does the entity undergo significant changes in appearance, function, ownership, or power?
3. **Character Associations**: Which characters are connected to this entity in each phase, and how?

### What Triggers a New Snapshot

Create a new snapshot when ANY of the following occurs:
- **Creation/Introduction**: The entity first appears or is created
- **Ownership/Association Change**: The entity passes to new hands or new characters gain access
- **Functional Change**: The entity's capabilities change (breaks, loses power, gains power, is repaired, is enhanced)
- **Significant Appearance Change**: The entity's visual presentation changes meaningfully (damaged, restored, modified, corrupted)
- **Status Change**: The entity's role or importance shifts (becomes forbidden, becomes legendary, is replicated)

### Handling Different Entity Types

**For Specific Objects** (weapons, armor, artifacts):
- Track creation, ownership transfers, protective instances, damage/repair, and ultimate fate
- Include the creator, current owner, and any characters who benefit from or are harmed by the object

**For Systems/Classes** (magic systems, organizations, species, ranks):
- Track introduction of the system, which characters have access/membership, rule changes, and systemic shifts
- A single snapshot may include many characters if they all share the same relationship to the system in that phase
- Note when characters gain or lose access to the system

**For Places/Locations**:
- Track discovery, changes in control/ownership, physical alterations, and significance shifts
- Include characters who inhabit, control, or are strongly associated with the location

### Content Guidelines

Each snapshot should capture:
1. **Visual State**: What does this entity look like in this phase? Include materials, colors, condition, distinctive features.
2. **Functional State**: What can this entity do? What is its purpose or power? Any limitations?
3. **Character Connections**: How do the listed characters relate to this entity? Who made it, owns it, uses it, is affected by it?
4. **Narrative Significance**: Why does this entity matter to the story at this point?

## Output Format
Return an XML document containing entity arc snapshots for ALL entities provided.

\`\`\`xml
<snapshots>
  <snapshot entity_id="entity-friendly-id">
    <character_id>character-friendly-id</character_id>
    <character_id>another-character-id</character_id>
    <tagline>Enchanted shield forged by Thrain, given to Elara for protection.</tagline>
    <chapters>1-10</chapters>
    <detail>Write flowing prose describing the entity's state in this phase. Cover its appearance, function, and relationship to the characters listed. Write in present tense. This should help a roleplayer understand what this entity is, what it looks like, what it does, and how the characters relate to it RIGHT NOW in this phase.</detail>
  </snapshot>
  <snapshot entity_id="entity-friendly-id">
    <character_id>character-friendly-id</character_id>
    <tagline>The shield's runes fail after battling the wyvern.</tagline>
    <chapters>11-25</chapters>
    <detail>Write flowing prose capturing how the entity has CHANGED from the previous phase. Explicitly contrast current state with past state (e.g., "Where the runes once glowed with steady light, they now flicker and fade..."). Focus on what event caused the change and how this affects the characters' relationship to the entity.</detail>
  </snapshot>
  <snapshot entity_id="another-entity-id">
    <character_id>character-friendly-id</character_id>
    <tagline>Cursed amulet binding Maren to her family's ancient pact.</tagline>
    <chapters>5-end</chapters>
    <detail>Prose describing this different entity...</detail>
  </snapshot>
</snapshots>
\`\`\`

The <chapters> element should contain a chapter range in one of these formats:
- "1-5" for a specific range
- "1-end" for chapters from 1 to the last chapter
- "1" for a single chapter (rare)

## Guidelines

### Character Inclusion
- Include ALL characters who have a meaningful connection to the entity in each phase
- For creation: include the creator
- For ownership: include current and former owners if the transfer happens in this phase
- For protection/harm: include both the entity's "agent" (if any) and the affected character
- For systems: include all characters who have access during this phase
- Use the character's id exactly as provided in the characters list

### Description Quality
- Write in vivid, evocative language matching the book's tone
- Be specific with visual details: colors, materials, textures, scale, condition
- For in-world terms, provide a brief definition in parentheses on first use
- Focus on what a camera would see AND what the entity can do
- Capture the emotional weight of the entity for the characters involved

### Phase Boundaries
- Chapter ranges should reflect genuine state changes, not arbitrary divisions
- An entity with no significant changes may have only one snapshot spanning the entire book
- An entity that transforms dramatically may have many snapshots
- When in doubt, fewer snapshots with richer detail is better than many thin snapshots

### Shared vs. Unique Entities
- For shared entities (magic systems, organizations): describe the general nature and note which characters have access
- For unique entities (specific weapons, personal artifacts): describe the specific instance and its particular owners/users
- If a shared entity manifests differently for different characters, note those variations

### Tagline Guidelines
The <tagline> is a punchy, at-a-glance descriptor (10-20 words) that helps determine relevance without reading the full detail:
- **First snapshot**: What the entity is and who it involves (e.g., "Enchanted shield forged by Thrain, given to Elara for protection.")
- **Subsequent snapshots**: What changed or the current state (e.g., "The shield's runes fail after battling the wyvern.")

Taglines should read like a headline—concise and informative, not a full summary.

Your response must be valid XML following the format above, containing a single <snapshots> element with one or more <snapshot> children. Each snapshot must have an entity_id attribute referencing the entity it describes, one or more <character_id> tags, followed by <tagline>, <chapters>, and <detail> tags. Generate snapshots for ALL entities provided.`;

export default createPrompt(meta, prompt);
