import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

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
  name: 'Extract Character Attributes from Chapter',
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

You are an expert literary analyst specializing in detailed character analysis. Your task is to act as a meticulous scribe, reading the <chapter_text> above to identify and document all physical and non-physical attributes of specific characters.

Here is a list of character names to focus on:

<character_list>
{% for character in characters %}
<character id="{{ character.friendlyId }}">
  <name>{{ character.name }}</name>
  {% if character.description %}<description>{{ character.description }}</description>{% endif %}

</character>
{% endfor %}
</character_list>

## Your Task

Build a detailed profile for each character from the character list based *only* on information present in the <chapter_text> above. Do not use information from other sources or make assumptions beyond what is explicitly stated or very strongly implied in this specific text.

## What Constitutes an Attribute

Look for any descriptive phrase or statement that reveals information about a character. Attributes should describe what a character *is* or *is like*, not what they are *doing* at a specific moment. Focus on inherent qualities and states of being (even temporary ones like injuries) rather than transient actions or activities. For example, "is injured" is a valid attribute, but "is walking to the store" is not.

Attributes fall into these categories:

- **PHYSICAL**: Eye color, hair color/style, height, build, distinctive markings (scars, tattoos), clothing, age indicators, etc.
- **SKILL**: Proficiency with weapons, crafts, or general abilities (swordsmanship, alchemy, stealth, eloquence, etc.)
- **POWER**: Unique or magical abilities (mind-reading, pyromancy, healing, supernatural strength, etc.)
- **LIMITATION**: Specific inabilities, vulnerabilities, or flaws (cannot swim, afraid of heights, poor eyesight, etc.)
- **PERSONALITY**: Core aspects of demeanor or character (brave, cautious, arrogant, witty, kind, cruel, etc.)

## Extraction Rules

For each attribute you identify:
1. Only extract what is explicitly stated or very strongly implied in the chapter text.
2. Focus only on characters from the provided character list. Ignore any other characters mentioned in the chapter.
3. Extract the specific trait name, its value/description, and supporting evidence.
4. Assign each attribute to one of the five categories above.

## Output Format

Provide your analysis as XML in the following structure:

<characters>
  <character id="[id]">
    <attribute category="[CATEGORY]" name="[Attribute Name]">
      <value>[Attribute Value]</value>
      <evidence>[Supporting quote and brief justification]</evidence>
    </attribute>
  </character>
</characters>

## Examples

### Example 1: Basic Attributes

If the character list contained "Lyra Stormborn" with ID "lyra_stormborn" and the chapter text contained: "Lyra pushed a lock of raven-black hair from her face. Her eyes, the color of moss, scanned the horizon. Unlike her companion, she was useless with a sword, but her ability to soothe wild beasts was second to none."

The output would be:

<characters>
  <character id="lyra_stormborn">
    <attribute category="PHYSICAL" name="Hair Color">
      <value>Raven-black</value>
      <evidence>She is described as having "raven-black hair"</evidence>
    </attribute>
    <attribute category="PHYSICAL" name="Eye Color">
      <value>Moss green</value>
      <evidence>Her eyes are described as "the color of moss"</evidence>
    </attribute>
    <attribute category="LIMITATION" name="Swordsmanship">
      <value>Unskilled</value>
      <evidence>The text explicitly states she was "useless with a sword"</evidence>
    </attribute>
    <attribute category="POWER" name="Animal Empathy">
      <value>Can soothe wild beasts</value>
      <evidence>She has an "ability to soothe the wild beasts" that is "second to none"</evidence>
    </attribute>
  </character>
</characters>

### Example 2: Distinguishing Traits from Activities

If the character list contained "Kaelen of Moonhaven" with ID "kaelen" and the chapter text contained: "Kaelen moved through the forest with a practiced silence, his silver hair catching the moonlight. His gaze was sharp, missing no detail in the shadows. After his watch, he returned to camp."

The output should focus on his characteristics, not his actions:

<characters>
  <character id="kaelen">
    <attribute category="SKILL" name="Stealth">
      <value>Practiced silence</value>
      <evidence>He "moved through the forest with a practiced silence".</evidence>
    </attribute>
    <attribute category="PHYSICAL" name="Hair Color">
      <value>Silver</value>
      <evidence>He is described as having "silver hair".</evidence>
    </attribute>
    <attribute category="PERSONALITY" name="Observant">
      <value>Sharp gaze</value>
      <evidence>His gaze was "sharp, missing no detail in the shadows".</evidence>
    </attribute>
  </character>
</characters>

Do NOT extract transient activities like "returned to camp". The attribute \`name\` and \`value\` should describe a trait or characteristic, not a log of actions.

Remember:
- Only extract attributes for characters listed in the provided character list.
- You MUST use the exact character ID from the <character_list>.
- Base your analysis solely on information present in the chapter text.
- Adhere strictly to the provided XML format for your output.

Now, analyze the chapter text and extract character attributes following these instructions.`;

export default createPrompt(meta, prompt);
