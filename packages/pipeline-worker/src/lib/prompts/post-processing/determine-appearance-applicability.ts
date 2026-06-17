import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  entity: v.object({
    friendlyId: v.string(),
    name: v.string(),
    type: v.string()
  }),
  attributes: v.array(
    v.object({
      chapterIdx: v.number(),
      category: v.string(),
      name: v.string(),
      value: v.string(),
      evidence: v.string()
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Determine Appearance Applicability',
  input: InputSchema
};

const prompt = `You are analyzing character/entity attributes to determine the availability of key appearance attributes. Your task is to examine the provided attributes and, for each of the six core appearance attributes, determine how (or whether) the information can be obtained.

<entity_data>
ID: {{ entity.friendlyId }}
Name: {{ entity.name }}
Type: {{ entity.type }}

{% for attribute in attributes %}
Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
{% endfor %}
</entity_data>

For each of the six appearance attributes below, determine:

1. **Applicability**: Does this attribute make sense for this entity?
   - A crystalline golem has no hair equivalent → hair_color is not applicable
   - A blind character or eyeless creature → eye_color may still be applicable if eyes exist but don't function
   - A formless entity → build/height may not be applicable

2. **Finding values**: Look for the attribute value using these methods (in order of preference):

   **Explicit** - The value is directly stated:
   - "blue eyes", "six feet tall", "muscular build", "25 years old"
   - If the value changes over time, include the aggregated/final values

   **Inferred from attributes** - The value can be reasoned from other attributes:
   - Composite descriptors: "willowy" → tall height + slender build; "stocky" → shorter height + broad build
   - Body part descriptions: "pale hands", "dark face", "bronze arms" → skin_tone
   - Related features: "blonde eyebrows", "red beard" → hair_color (unless dyed or bald)
   - Age indicators: "wrinkled face", "gray at the temples" → elderly; "baby-faced" → young
   - Size descriptors: "looming over others", "could barely reach the shelf" → height
   - Physique hints: "arms like tree trunks", "bony fingers", "broad shoulders" → build

   **Inferred via comparison** (use tools when needed):
   - Look for phrases like "shorter than Killian", "eyes darker than Marcus", "older than her brother Theo"
   - Only consider comparisons to explicitly named characters (not "shorter than you", "taller than the girl")
   - Use \`lookup_other_character_attribute\` to find the compared character's value
   - Example: "shorter than Killian" → call \`lookup_other_character_attribute({character_name: "Killian", attribute_keywords: ["height", "tall", "feet", "inches"]})\` to find Killian's height, then infer {{ entity.name }}'s height is less

   **Inferred via context** (use tools when needed):
   - Look for titles, ranks, or roles: "first-year student", "senior apprentice", "veteran soldier"
   - Use \`search_character_attributes\` to find other characters with that context
   - Example: "first-year student" with no explicit age → call \`search_character_attributes({context_keywords: ["first-year", "freshman"], attribute_keywords: ["age", "years old"]})\` to find typical ages

---

**The Six Core Attributes:**

- **eye_color**: Any description of eyes or visual organs. For humans: "blue eyes", "dark eyes". For creatures: "glowing red orbs", "multifaceted insect eyes". Mark as not applicable only if the entity clearly has no eyes or visual organs.

- **skin_tone**: Any description of outer covering. For humans: "pale skin", "bronze complexion". For creatures: "emerald scales", "thick gray hide", "chitinous carapace", "white fur". Any body surface description counts.

- **hair_color**: Any description of hair, fur, mane, or equivalent. Mark as not applicable if the entity clearly has no hair equivalent (scaled, insectoid, crystalline beings), or if explicitly stated as bald/hairless.

- **age**: Any indication of age or life stage. For humans: "25 years old", "elderly", "young adult". For creatures: "ancient", "juvenile", "newly hatched". Relative age terms count.

- **height**: Any description of size or stature. For humans: "tall", "5'9"", "petite". For creatures: "massive", "towering", "the size of a horse". Translate to human-scale measurements when possible—lead with the concrete estimate rather than relative terms like "small" or "large" (e.g., "a few feet taller than a short human" → "~7-8 feet"; "the size of a horse" → "~5-6 feet at the shoulder").

- **build**: Any description of body shape, physique, or form. For humans: "muscular", "slender", "stocky". For creatures: "serpentine", "bulky", "lithe", "spindly-limbed".

---

**Output Format:**

Return an XML document. The structure for each attribute follows this pattern:

\`\`\`xml
<attribute_analysis>
  <!-- Repeat for each of the 6 attributes: eye_color, skin_tone, hair_color, age, height, build -->
  <attribute name="ATTRIBUTE_NAME">
    <applicable>true|false</applicable>

    <!-- If applicable is FALSE, include reason: -->
    <reason>Why this attribute doesn't apply to this entity</reason>

    <!-- If applicable is TRUE, include either value or missing: -->
    <value source="explicit|inferred">The attribute value</value>
    <missing>true</missing>  <!-- Only if no value could be found or inferred -->
  </attribute>
</attribute_analysis>
\`\`\`

**Rules:**

1. Every attribute must have \`<applicable>\` set to true or false
2. If \`<applicable>\` is false, include a \`<reason>\` explaining why
3. If \`<applicable>\` is true, include either \`<value>\` or \`<missing>\`
4. The \`source\` attribute on \`<value>\` must be "explicit" (directly stated) or "inferred" (reasoned from other attributes or determined via tools)
5. Use \`<missing>\` only when no value could be found or reasonably inferred

---

**Example Output:**

\`\`\`xml
<attribute_analysis>
  <attribute name="eye_color">
    <applicable>true</applicable>
    <value source="explicit">blue with golden flecks</value>
  </attribute>

  <attribute name="skin_tone">
    <applicable>true</applicable>
    <value source="inferred">pale (described as having "pale hands" and "pallid complexion")</value>
  </attribute>

  <attribute name="hair_color">
    <applicable>true</applicable>
    <value source="inferred">blonde (inferred from "blonde eyebrows")</value>
  </attribute>

  <attribute name="height">
    <applicable>true</applicable>
    <value source="inferred">tall (described as "willowy" and "looming over the other students")</value>
  </attribute>

  <attribute name="age">
    <applicable>true</applicable>
    <value source="inferred">17-18 years old (first-year student; other first-years are 17-18)</value>
  </attribute>

  <attribute name="build">
    <applicable>true</applicable>
    <value source="inferred">slender (described as "willowy" with "thin wrists")</value>
  </attribute>
</attribute_analysis>
\`\`\`

**Example for non-applicable attribute (e.g., crystalline golem entity):**

\`\`\`xml
  <attribute name="hair_color">
    <applicable>false</applicable>
    <reason>Crystalline golem with no hair equivalent</reason>
  </attribute>
\`\`\`

Your response must be valid XML following the format above.`;

export default createPrompt(meta, prompt);
