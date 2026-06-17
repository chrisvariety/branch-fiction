import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  places: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string()
    })
  ),
  attributes: v.array(
    v.object({
      location: v.string(),
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
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Place Arc',
  input: InputSchema
};

const prompt = `You are analyzing a hierarchy of locations from a fantasy novel to create roleplay-ready setting snapshots.

## Location Hierarchy
You will analyze the following locations and their relationships. This includes parent locations (e.g., "Thornhaven") and all their sub-locations (e.g., "Thornhaven > Training Quarter", "Thornhaven > Training Quarter > practice arena").

<locations>
{% for place in places %}
  <location id="{{ place.friendlyId }}">{{ place.name }}</location>
{% endfor %}
</locations>

## Location Attributes
The following attributes describe these locations across the book, organized by chapter. Categories include (but are not limited to) PHYSICAL (appearance, features), SPATIAL (layout, connections), CULTURAL (atmosphere, significance), and FUNCTIONAL (what happens here).

<attributes>
{% for attribute in attributes %}
Chapter {{ attribute.chapterIdx }} - {{ attribute.location }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
{% endfor %}
</attributes>

{% if relationships.length > 0 %}
## Scenes at These Locations
The following relationship interactions occur at these locations, giving context for what kinds of dynamics play out here.

<relationships>
{% for relationship in relationships %}
{{ relationship }}
{% endfor %}
</relationships>
{% endif %}

{% if relatedEntities and relatedEntities.length > 0 %}
<related_entities>
The following entities are related to these locations and may provide valuable context for understanding the place arcs.

{% for entity in relatedEntities %}
<entity id="{{ entity.friendlyId }}" type="{{ entity.type }}"{% if entity.phrasesUsed %} phrases="{{ entity.phrasesUsed }}"{% endif %}>{{ entity.summary }}</entity>
{% endfor %}
</related_entities>

You have access to the following tool:
* \`lookup_related_entity({id: string})\`: Retrieves detailed information about a related entity using its ID from the list above.

**When to Use the Tool**: After reviewing the location attributes and related entities, use \`lookup_related_entity\` to gather additional context about any related entities that significantly impact these locations. For example:
- If a location contains or is associated with significant objects (artifacts, weapons, monuments), look them up to understand how they affect the place's meaning
- If characters are strongly tied to a location (rulers, guardians, founders), look them up to understand their influence on the place
- If the location is part of a larger organizational or cultural system (kingdoms, factions, religious orders), look them up for contextual details
- If creatures or forces inhabit or threaten the location, look them up to understand their impact on the place's state

**When NOT to Use the Tool**: Skip entities that are:
- Mentioned only in passing without significant impact on the location's evolution
- Generic or non-specific references
- Abstract concepts that don't have concrete manifestations affecting the place

Use the tool strategically to enrich your understanding of how these locations evolve with accurate, specific details about the entities that shape them.

**Workflow**: Before writing your final location arc snapshots, review the related_entities list and use the \`lookup_related_entity\` tool to gather details about any entities that would enhance your understanding of how these places transform throughout the story.

{% endif %}

## Task

For each location, identify how THE PLACE ITSELF transforms across the story. You are tracking **location evolution**, not plot events.

Look for two types of transformation:

### 1. Physical Transformation
How does the location's appearance, condition, or environment change?
- Destruction or decay (rubble, fire damage, abandoned)
- Seasonal shifts (snow-covered, spring bloom, summer heat)
- Construction or repair (rebuilt walls, new additions)
- Environmental change (flooded, overgrown, scorched earth)

### 2. Emotional/Symbolic Transformation
How does the location's *meaning* or *atmosphere* shift for characters?
- A training yard becomes a memorial for fallen friends
- A childhood bedroom becomes haunted by betrayal
- A battlefield becomes sacred ground
- A prison becomes a sanctuary

**Important:** If a location does NOT meaningfully transform (it remains physically and emotionally consistent), give it only ONE snapshot. Not every location needs multiple arcs.

## Output Format

Return an XML document containing location snapshots. Only create multiple snapshots when the location genuinely transforms.

\`\`\`xml
<snapshots>
  <snapshot>
    <location>Location id from the locations list</location>
    <phase>Evocative 3-5 word title capturing THIS version of the place</phase>
    <chapters>1-5</chapters>
    <detail>Write a single, flowing paragraph (or multiple connected paragraphs if needed) describing the place itself at this point in the story. For in-world terms (e.g., 'ward', 'ley line', 'scrying pool'), provide a definition in parentheses immediately after the term first appears.</detail>
  </snapshot>
  <snapshot>
    <location>Another location id</location>
    <phase>Another phase title</phase>
    <chapters>6-12</chapters>
    <detail>Write a single, flowing paragraph (or multiple connected paragraphs if needed) for the next phase...</detail>
  </snapshot>
</snapshots>
\`\`\`

### Writing Snapshots

**First snapshot for a location:** Establish the baseline. Describe the physical reality (appearance, sensory details like smell or sound, condition) and what this place represents emotionally at the story's start.

**Subsequent snapshots:** Describe how the place has CHANGED from its previous state. What's different now? Use contrast language ("where once... now...", "the same stones that had been... are now..."). Capture both physical changes (if any) and shifts in emotional meaning.

## Examples

### BAD (scene summary—don't do this):
> "The guild hall buzzes with activity as recruits gather for morning assignments. Kira argues with Marshal Thorne about her patrol route while others spar in the corner. Tensions rise between the old guard and the newcomers from the borderlands."

This describes EVENTS and CHARACTERS, not the PLACE itself.

### GOOD (location baseline):
> "Morning light streams through the guild hall's vaulted windows, catching dust motes above the long oak tables scarred by decades of knife-sharpening and spilled ale. Faded campaign banners hang from the rafters, each one marking a battle the order survived. The ancient hearthfire (magical flame that never requires fuel) crackles year-round, filling the space with warmth and the smell of pine smoke. For new recruits, this hall represents belonging—proof they've earned a place among the sworn."

### GOOD (location transformation):
> "The guild hall's vaulted windows are shattered now, autumn wind cutting through where colored glass once filtered the light. The long oak tables have been shoved against the walls to make room for cots, their scarred surfaces serving as makeshift surgical stations. The campaign banners still hang from the rafters, but soot from siege fire has blackened them beyond recognition. Where the ancient hearthfire once meant warmth and belonging, the cold hearth now marks everything the order has lost."

## Guidelines

- Focus on THE PLACE, not the people or plot events
- Physical details should describe the location's STATE (damaged, pristine, weathered, seasonal)
- Emotional weight is about what the place REPRESENTS, not what scenes occur there
- Later snapshots should explicitly reference how the location has changed from before
- Only create multiple arcs if the location genuinely transforms—most locations may only need one
- A location can transform emotionally without physical change (and vice versa)
- Engage the senses: Ensure every snapshot includes at least one non-visual detail (sound, smell, temperature, or texture)

Your response must be valid XML following the format above, containing a single <snapshots> element with one or more <snapshot> children, each with <location>, <phase>, <chapters>, and <detail> tags.`;

export default createPrompt(meta, prompt);
