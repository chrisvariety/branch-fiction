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
  name: 'Extract Entity Attributes from Chapter',
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

You are an expert Lore Master and world-building chronicler. Your task is to act as a meticulous cataloger, reading the <chapter_text> above to identify and document all defining attributes of specific world elements (items, organizations, creatures, artifacts, concepts, etc.).

Here is a list of entities to focus on:

<entity_list>
{% for entity in entities %}
<entity type="{{ entity.type }}" id="{{ entity.friendlyId }}">
  <name>{{ entity.name }}</name>
  {% if entity.description %}<description>{{ entity.description }}</description>{% endif %}

</entity>
{% endfor %}
</entity_list>

## Your Task

Build a detailed profile for each entity from the entity list based *only* on information present in the <chapter_text> above. Do not use information from other sources or make assumptions beyond what is explicitly stated or very strongly implied in this specific text.

## What Constitutes an Attribute

Look for any descriptive phrase or statement that reveals information about an entity. Attributes should describe what an entity *is*, *does*, or *represents*, not momentary interactions or fleeting references. Focus on defining characteristics and properties rather than transient events. For example, "is protected by ancient wards" is a valid attribute, but "a character walked past it" is not.

Attributes fall into these categories:

- **PHYSICAL**: Appearance, materials, construction, size, shape, color, texture, architectural features, composition, condition, etc.
- **FUNCTIONAL**: Purpose, capabilities, uses, mechanisms, effects, how it operates or what it does, etc.
- **HISTORICAL**: Origins, creation, age, past events, previous owners, transformations, historical significance, etc.
- **MAGICAL**: Supernatural properties, enchantments, curses, mystical effects, magical protections, etc.
- **CULTURAL**: Reputation, beliefs, symbolism, significance to groups, legends, widespread perceptions, etc.
- **RELATIONAL**: Ownership, governance, connections to characters/organizations, location within larger structures, etc.

## Extraction Rules

For each attribute you identify:
1. Only extract what is explicitly stated or very strongly implied in the chapter text.
2. Focus only on entities from the provided entity list. Ignore any other entities mentioned in the chapter.
3. Extract the specific trait name, its value/description, and supporting evidence.
4. When an entity is possessed by, belongs to, part of, or specifically associated with a character, include that character's name in the value to maintain specificity. For example, if the text describes "Lyra's sigil" or "her sigil" (referring to Lyra), the value/description should contain "Lyra" as different characters may have different sigils.
5. Assign each attribute to one of the six categories above.

## Output Format

Provide your analysis as XML in the following structure:

<entities>
  <entity id="[id]">
    <attribute category="[CATEGORY]" name="[Attribute Name]">
      <value>[Attribute Value]</value>
      <evidence>[Supporting quote and brief justification]</evidence>
    </attribute>
  </entity>
</entities>

## Examples

### Example 1: Item Entity

If the entity list contained "Moonblade" with ID "moonblade" (type: OBJECT) and the chapter text contained: "The Moonblade gleamed in her hands, its silver edge catching the light. Unlike ordinary swords, it was forged from starfall metal and was said to cut through magical barriers as easily as flesh. The blade sang softly when swung, a haunting melody that unnerved her enemies."

The output should focus on its defining characteristics:

<entities>
  <entity id="moonblade">
    <attribute category="PHYSICAL" name="Blade Color">
      <value>Silver</value>
      <evidence>Described as having a "silver edge"</evidence>
    </attribute>
    <attribute category="PHYSICAL" name="Material">
      <value>Starfall metal</value>
      <evidence>"it was forged from starfall metal"</evidence>
    </attribute>
    <attribute category="MAGICAL" name="Barrier Penetration">
      <value>Cuts through magical barriers</value>
      <evidence>"said to cut through magical barriers as easily as flesh"</evidence>
    </attribute>
    <attribute category="MAGICAL" name="Sonic Effect">
      <value>Sings when swung</value>
      <evidence>"The blade sang softly when swung, a haunting melody that unnerved her enemies"</evidence>
    </attribute>
    <attribute category="FUNCTIONAL" name="Psychological Effect">
      <value>Unnerves enemies</value>
      <evidence>The song is described as "a haunting melody that unnerved her enemies"</evidence>
    </attribute>
  </entity>
</entities>

### Example 2: Organization Entity

If the entity list contained "The Silver Hand" with ID "silver_hand" (type: ORGANIZATION) and the chapter text contained: "The Silver Hand operated from the shadows, their network of spies and informants spanning every major city. Each member bore a distinctive silver ring engraved with a clenched fist. They answered only to the mysterious Council of Five, whose identities remained unknown even to most members."

The output would be:

<entities>
  <entity id="silver_hand">
    <attribute category="FUNCTIONAL" name="Operations Method">
      <value>Operates from the shadows</value>
      <evidence>"The Silver Hand operated from the shadows"</evidence>
    </attribute>
    <attribute category="FUNCTIONAL" name="Network Scope">
      <value>Spans every major city</value>
      <evidence>"their network of spies and informants spanning every major city"</evidence>
    </attribute>
    <attribute category="FUNCTIONAL" name="Member Roles">
      <value>Spies and informants</value>
      <evidence>Described as having "network of spies and informants"</evidence>
    </attribute>
    <attribute category="PHYSICAL" name="Member Identification">
      <value>Silver ring with clenched fist</value>
      <evidence>"Each member bore a distinctive silver ring engraved with a clenched fist"</evidence>
    </attribute>
    <attribute category="RELATIONAL" name="Leadership">
      <value>Governed by Council of Five</value>
      <evidence>"They answered only to the mysterious Council of Five"</evidence>
    </attribute>
    <attribute category="CULTURAL" name="Secrecy">
      <value>Leadership identities unknown</value>
      <evidence>The Council's "identities remained unknown even to most members"</evidence>
    </attribute>
  </entity>
</entities>

### Example 3: Character-Specific Entity

If the entity list contained "House Sigil" with ID "house_sigil" (type: OBJECT) and the chapter text contained: "Kaelen traced his fingers over his house sigil, a silver wolf etched into dark steel, marking him as heir to House Silverfang."

The output should specify which character the attributes belong to:

<entities>
  <entity id="house_sigil">
    <attribute category="PHYSICAL" name="Design">
      <value>Kaelen's sigil: silver wolf on dark steel</value>
      <evidence>"Kaelen traced his fingers over his house sigil, a silver wolf etched into dark steel"</evidence>
    </attribute>
    <attribute category="RELATIONAL" name="House Affiliation">
      <value>Kaelen's sigil marks him as heir to House Silverfang</value>
      <evidence>His sigil "marking him as heir to House Silverfang"</evidence>
    </attribute>
  </entity>
</entities>

Do NOT extract transient events like "a character touched the sword" or "the building was visited." The attribute \`name\` and \`value\` should describe an inherent property or characteristic of the entity itself, not a log of momentary interactions.

Remember:
- Only extract attributes for entities listed in the provided entity list.
- You MUST use the exact entity ID from the <entity_list>.
- Base your analysis solely on information present in the chapter text.
- Adhere strictly to the provided XML format for your output.

Now, analyze the chapter text and extract entity attributes following these instructions.`;

export default createPrompt(meta, prompt);
