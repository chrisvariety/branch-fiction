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
  places: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string()
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Entity Location Arcs',
  input: InputSchema
};

const prompt = `You are analyzing how world elements (objects, magic systems, organizations, etc.) relate to locations throughout a fantasy novel to create roleplay-ready entity snapshots grounded in place.

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

## Related Locations
The following locations have significant connections to these entities:

<locations>
{% for place in places %}
<location id="{{ place.friendlyId }}">{{ place.name }}</location>
{% endfor %}
</locations>

## Task
Analyze the relationship and attribute data to create entity arc snapshots that capture how each {{ entityType }} exists within and moves between locations through the story. Consider:

1. **Location Introduction**: Where is this entity first encountered? What location serves as its origin or primary home?
2. **Location Changes**: Does the entity move between locations? Is it transported, stolen, or relocated?
3. **Location Associations**: Which locations are connected to this entity in each phase, and how?

### What Triggers a New Snapshot

Create a new snapshot when ANY of the following occurs:
- **Discovery/Introduction**: The entity is first found or appears at a location
- **Relocation**: The entity moves to a new location (transported, carried, teleported)
- **Location Transformation**: The entity's presence fundamentally changes a location (corrupts it, sanctifies it, makes it dangerous)
- **Accessibility Change**: The entity becomes accessible or inaccessible at a location (hidden, revealed, locked away, displayed)
- **Location-Bound State Change**: The entity's condition changes due to location-specific factors (protected by a sanctuary, degrading in hostile environment)

### Handling Different Entity Types

**For Specific Objects** (weapons, armor, artifacts):
- Track where the object is created, stored, used, lost, and recovered
- Note locations that serve as resting places, battlegrounds, or display sites
- Include locations where the object's power is enhanced or diminished

**For Systems/Classes** (magic systems, organizations, species, ranks):
- Track which locations serve as centers of power, training grounds, or territories
- Note locations where the system is practiced, forbidden, or unknown
- Include locations that define boundaries of influence

**For Creatures/Beings** (non-character entities):
- Track habitat, migration, territory, and range
- Note locations of encounters, nesting, or spawning
- Include locations that serve as hunting grounds or refuges

### Content Guidelines

Each snapshot should capture:
1. **Location Context**: What is the location like? How does it relate to the entity's presence?
2. **Spatial State**: Where exactly is the entity within the location? How is it positioned or stored?
3. **Location Connections**: How do the listed locations relate to this entity? Where was it found, where is it kept, where does it function?
4. **Environmental Significance**: Why does this location matter to the entity at this point? How does place affect the entity's nature or power?

## Output Format
Return an XML document containing entity arc snapshots for ALL entities provided.

\`\`\`xml
<snapshots>
  <snapshot entity_id="entity-friendly-id">
    <place_id>location-friendly-id</place_id>
    <place_id>another-location-id</place_id>
    <tagline>Ancient runeblade forged in the dwarven halls, displayed in the castle armory.</tagline>
    <chapters>1-10</chapters>
    <detail>Write flowing prose describing the entity's relationship to these locations in this phase. Cover where the entity is found, how it interacts with the space, and what the location means to the entity. Write in present tense. This should help a roleplayer understand WHERE this entity exists and how place shapes its nature RIGHT NOW in this phase.</detail>
  </snapshot>
  <snapshot entity_id="entity-friendly-id">
    <place_id>new-location-id</place_id>
    <tagline>The runeblade travels north to the fortress as war approaches.</tagline>
    <chapters>11-25</chapters>
    <detail>Write flowing prose capturing how the entity's location has CHANGED from the previous phase. Explicitly contrast current location with past location (e.g., "No longer displayed in the peaceful armory, the blade now rests in a war tent..."). Focus on what caused the relocation and how the new environment affects the entity.</detail>
  </snapshot>
  <snapshot entity_id="another-entity-id">
    <place_id>location-friendly-id</place_id>
    <tagline>Sacred grove where the forest spirits gather each moonrise.</tagline>
    <chapters>5-end</chapters>
    <detail>Prose describing this different entity's location context...</detail>
  </snapshot>
</snapshots>
\`\`\`

The <chapters> element should contain a chapter range in one of these formats:
- "1-5" for a specific range
- "1-end" for chapters from 1 to the last chapter
- "1" for a single chapter (rare)

## Guidelines

### Location Inclusion
- Include ALL locations that have a meaningful connection to the entity in each phase
- For creation: include the location where the entity was made or first appeared
- For storage: include locations where the entity rests or is kept
- For use: include locations where the entity is actively employed
- For movement: include both origin and destination if relocation happens in this phase
- Use the location's id exactly as provided in the locations list

### Description Quality
- Write in vivid, evocative language matching the book's tone
- Be specific with spatial details: where within the location, how positioned, what surrounds it
- For in-world location names, provide a brief description in parentheses on first use
- Focus on the interplay between entity and environment
- Capture how place enhances, diminishes, or transforms the entity

### Phase Boundaries
- Chapter ranges should reflect genuine location changes, not arbitrary divisions
- An entity that never moves may have only one snapshot spanning the entire book
- An entity that travels extensively may have many snapshots
- When in doubt, fewer snapshots with richer spatial detail is better than many thin snapshots

### Fixed vs. Mobile Entities
- For fixed entities (landmarks, buildings, portals): describe how the location IS the entity
- For mobile entities (objects, creatures): describe how the entity moves through and relates to locations
- If an entity exists in multiple locations simultaneously (copies, manifestations), note those variations

### Tagline Guidelines
The <tagline> is a punchy, at-a-glance descriptor (10-20 words) that helps determine relevance without reading the full detail:
- **First snapshot**: What the entity is and where it exists (e.g., "Ancient runeblade forged in the dwarven halls, displayed in the castle armory.")
- **Subsequent snapshots**: What changed or the current location (e.g., "The runeblade travels north to the fortress as war approaches.")

Taglines should read like a headline—concise and informative, not a full summary.

Your response must be valid XML following the format above, containing a single <snapshots> element with one or more <snapshot> children. Each snapshot must have an entity_id attribute referencing the entity it describes, one or more <place_id> tags, followed by <tagline>, <chapters>, and <detail> tags. Generate snapshots for ALL entities provided.`;

export default createPrompt(meta, prompt);
