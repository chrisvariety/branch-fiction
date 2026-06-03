import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  entities: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      type: v.string(),
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
  name: 'Extract Place Attributes from Chapter',
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

You are an expert Cartographer and Architectural Historian. Your task is to act as a meticulous cataloger, reading the <chapter_text> above to identify and document all defining attributes of specific **Locations**.

Your primary goal is to extract details that help define the **identity, atmosphere, and scope** of a place, allowing us to understand if it is a continent, a city, a building, or a single room.

Here is a list of Locations to focus on:

<entity_list>
{% for entity in entities %}
<entity type="LOCATION" id="{{ entity.friendlyId }}">
  <name>{{ entity.name }}</name>
  {% if entity.description %}<description>{{ entity.description }}</description>{% endif %}
</entity>
{% endfor %}
</entity_list>

## Your Task

Build a detailed profile for each Location from the entity list based *only* on information present in the <chapter_text> above. Do not use information from other sources or make assumptions beyond what is explicitly stated or very strongly implied.

## What Constitutes a Location Attribute

Look for any descriptive phrase that reveals the nature of the place. Attributes should describe the location's permanent or semi-permanent state, not fleeting events (e.g., "walls lined with books" is a valid attribute; "Xaden walked through the door" is not).

Attributes fall into these categories:

- **SPATIAL**: Hierarchy, containment, scale, and geography. Describes what the location is *inside of* (parent), what it *contains* (children/sub-locations), and its relative scope (e.g., "located within the capital", "contains the throne room", "a cramped closet", "a sprawling empire").
- **PHYSICAL**: Appearance, architecture, layout, terrain, climate, construction materials, lighting, sensory details (smell, sound), size, and condition.
- **FUNCTIONAL**: Purpose, utility, strategic importance, or what distinct activities are performed there (e.g., "training ground," "sleeping quarters," "trade post").
- **HISTORICAL**: Origins, founding, age, ruins, previous eras, or significant past events that define the place.
- **MAGICAL**: Supernatural properties, wards, enchantments, curses, or magical phenomena strictly tied to the location.
- **CULTURAL**: Reputation, atmosphere/vibe, religious significance, laws, demographics, or how people feel about the place (e.g., "ominous," "sacred," "bustling").
- **RELATIONAL**: Ownership, governance, political alignment, or connections to specific factions/houses.

## Extraction Rules

For each attribute you identify:
1. Only extract what is explicitly stated or very strongly implied.
2. Focus only on the Locations in the provided entity list.
3. **Capture Containment:** If the text says "The Archives are located deep beneath the Citadel," you must extract that the Archives are *inside* the Citadel.
4. **Character Associations:** When a location is possessed by, belongs to, or is specifically associated with a character, include that character's name in the value to maintain specificity. For example, if the text describes "the King's chambers" or "her study" (referring to Lyra), the value/description should contain the character name as different characters may have different chambers or studies.
5. **Contextual References:** Pay close attention to words like 'here', 'this place', 'the area', 'the hall', or 'the city' when they refer to the current location. These typically refer to the scene's location attribute (if present in the entity list) or, if location is not specified, the setting attribute. In your evidence field, explicitly clarify what the reference means, e.g., '"there are many roses here" - where "here" refers to Royal Gardens (scene location)'.
6. Assign each attribute to one of the categories above.

## Output Format

Provide your analysis as XML in the following structure:

<entities>
  <entity id="[id]">
    <attribute category="[CATEGORY]" name="[Attribute Name]">
      <value>[Attribute Value]</value>
      <evidence>[Supporting quote]</evidence>
    </attribute>
  </entity>
</entities>

## Examples

### Example 1: Location Entity

If the entity list contained "The Obsidian Spire" with ID "obsidian_spire" and the chapter text contained: "The Obsidian Spire rose from the center of the wasteland, a jagged tower of black volcanic glass. It housed the Chamber of Echoes on its highest floor. Ancient wards hummed around its base, preventing entry. Strange symbols were carved into the black stone here, predating any known language."

The output would be:

<entities>
  <entity id="obsidian_spire">
    <attribute category="SPATIAL" name="Parent Location">
      <value>The Wasteland</value>
      <evidence>"rose from the center of the wasteland"</evidence>
    </attribute>
    <attribute category="SPATIAL" name="Structure Type">
      <value>Tower</value>
      <evidence>Described as "a jagged tower"</evidence>
    </attribute>
    <attribute category="SPATIAL" name="Contains">
      <value>Chamber of Echoes (highest floor)</value>
      <evidence>"It housed the Chamber of Echoes on its highest floor"</evidence>
    </attribute>
    <attribute category="PHYSICAL" name="Material">
      <value>Black volcanic glass</value>
      <evidence>"tower of black volcanic glass"</evidence>
    </attribute>
    <attribute category="MAGICAL" name="Protective Wards">
      <value>Ancient wards preventing entry</value>
      <evidence>"Ancient wards hummed around its base, preventing entry"</evidence>
    </attribute>
    <attribute category="PHYSICAL" name="Inscriptions">
      <value>Symbols predating known languages</value>
      <evidence>"Strange symbols were carved into the black stone here" - where "here" refers to The Obsidian Spire (scene location)</evidence>
    </attribute>
  </entity>
</entities>

Do NOT extract transient events like "a character walked through the room" or "the building was visited." The attribute \`name\` and \`value\` should describe an inherent property or characteristic of the location itself, not a log of momentary interactions.

Remember:
- Only extract attributes for locations listed in the provided entity list.
- You MUST use the exact entity ID from the <entity_list>.
- Base your analysis solely on information present in the chapter text.
- Adhere strictly to the provided XML format for your output.

Now, analyze the chapter text and extract location attributes following these instructions.`;

export default createPrompt(meta, prompt);
