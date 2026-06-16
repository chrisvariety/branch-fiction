import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  type: v.picklist(['CHARACTER_HORIZONTAL', 'CHARACTER_VERTICAL']),
  artStyle: v.nullable(v.string()),
  characters: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      label: v.nullish(v.string()),
      pronouns: v.nullish(v.string()),
      description: v.nullish(v.string()),
      arc: v.nullish(v.string())
    })
  ),
  relationships: v.array(
    v.object({
      title: v.string(),
      content: v.string(),
      entities: v.array(v.string())
    })
  ),
  place: v.object({
    name: v.string(),
    description: v.nullish(v.string()),
    arc: v.string()
  }),
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
  name: 'Character Dynamics',
  input: InputSchema
};

const prompt = `You will be creating a structured scene description that positions characters spatially within a specific location based on their relationships and narrative importance. Your output must be **detailed for character visuals but concise for scene positioning**.

Here is the list of characters with detailed appearance information, ordered by narrative importance (most important characters first):

<characters>
{% for character in characters %}
  <character id="{{ character.friendlyId }}">
    <name>{{ character.name }}</name>
    {% if character.label %}<label>{{ character.label }}</label>{% endif %}
    {% if character.pronouns %}
    <pronouns>{{ character.pronouns }}</pronouns>

    {% endif %}
    {% if character.arc %}
    <appearance>{{ character.arc }}</appearance>

    {% endif %}
  </character>
{% endfor %}
</characters>

Here are the relationships between these characters:

<relationships>
{% for relationship in relationships %}
  <relationship>
    <characters>{{ relationship.entities | join(', ') }}</characters>
    <title>{{ relationship.title }}</title>
    <content>{{ relationship.content }}</content>
  </relationship>
{% endfor %}
</relationships>

The scene should be set in the following location:

<location>
  <name>{{ place.name }}</name>
  {% if place.description %}
    <description>{{ place.description }}</description>
  {% endif %}
  <appearance>{{ place.arc }}</appearance>
</location>

{% if relatedEntities and relatedEntities.length > 0 %}
<related_entities>
The following entities are related to the characters or location and may provide valuable context:

{% for entity in relatedEntities %}
<entity id="{{ entity.friendlyId }}" type="{{ entity.type }}"{% if entity.phrasesUsed %} phrases="{{ entity.phrasesUsed }}"{% endif %}>{{ entity.summary }}</entity>
{% endfor %}
</related_entities>

You have access to the following tool:
* \`lookup_related_entity_appearance({id: string})\`: Retrieves detailed visual information about a related entity using its ID from the list above.

**When to Use the Tool**: Use \`lookup_related_entity_appearance\` to gather visual details about items characters are wearing/carrying (weapons, armor, magical items, distinctive accessories), architectural elements, or magical elements that would appear in the scene. This is CRITICAL for producing accurate visual descriptions.

**When NOT to Use the Tool**: Skip abstract concepts, generic references, or entities without direct visual presence in the scene.
{% endif %}

---

## OUTPUT FORMAT REQUIREMENTS

Your output MUST follow this exact two-section structure inside \`<scene_description>\` tags. Here is an example:

\`\`\`
<scene_description>
<characters>
<character id="elara">Petite young woman of slender build with pale skin, long auburn hair streaked with white flowing past shoulders, and green eyes with faint magical glow; wears a tattered gray traveling cloak of coarse wool over fitted brown leather armor with brass buckles at shoulders and waist, leather satchel with silver clasp at hip containing spell components.</character>
<character id="grimjaw">Massive 8ft stone golem of cracked gray granite body with glowing blue runic inscriptions across broad chest, one arm terminating in a heavy stone war hammer, the other forming a thick rounded shield; moss grows in the crevices of ancient joints, eyes are deep-set pits of soft blue light.</character>
<character id="whisper">Tiny 1ft shadow-sprite of wispy humanoid form composed of dark shifting smoke with constantly undulating edges, two bright yellow eyes like floating orbs, carries a tiny silver lantern with pale blue flame on a delicate chain.</character>
<character id="captain_aldric">Weathered older man of 6'1" broad-shouldered build with graying beard, prominent burn scar across left cheek from jaw to temple; wears dented steel plate armor with faded royal crest of golden lion on chest, leather sword belt with tarnished brass buckle, longsword with worn leather grip at waist.</character>
</characters>

<scene>
Polished semi-realistic digital illustration at dusk.

First, create the background: a crumbling stone bridge stretching over a misty chasm, with an ancient archway entrance to a mountain fortress visible in the distance. Purple-orange sunset filters through clouds, casting rim lighting that creates strong silhouette opportunities against the misty depths below.

Next, in the mid-ground on the right side, place Captain Aldric (graying beard, burn scar on left cheek) standing arms-crossed, watching skeptically toward the bridge's edge, hand resting on sword pommel.

Then, at the foreground center at the largest scale, position Elara (petite woman, auburn hair with white streak, glowing green eyes) at the bridge's edge, one hand extended toward the fortress. A few paces to her left, place Grimjaw (8ft granite golem, blue chest runes) looming protectively with shield-arm raised. Above and between them, add Whisper (tiny shadow-sprite, yellow eyes) hovering with lantern casting pale light.

All characters positioned at 3/4 angles toward viewer.
</scene>
</scene_description>
\`\`\`

---

## CRITICAL FORMATTING RULES

1. **CHARACTER DESCRIPTIONS** (one \`<character id="id">\` element per character): Write rich visual descriptions that capture the character's complete appearance:

   **Physical Features (required):**
   - Gender and body type as the opening noun phrase (e.g., "Petite young woman," "Massive 8ft male golem," "Weathered older man"), using the character's pronouns and appearance to determine gender presentation
   - Build, height/size (use measurements when provided)
   - Skin tone/texture, face shape, distinctive facial features
   - Hair color, style, length, and any unique qualities
   - Eye color and any distinctive qualities
   - **Resolve Size Conflicts:** If a description contains conflicting size terms (e.g., "petite" vs "7ft"), prioritize the concrete measurement. For creatures larger than humans described as "petite" or "small," replace those adjectives with terms describing **build** (e.g., "slender," "gracile," "wiry," "juvenile") to avoid scaling errors.

   **Clothing & Equipment (required when present):**
   - Describe clothing with specific materials, colors, and construction details
   - Include armor with type, material, color, and distinctive features
   - Describe weapons with blade type, hilt details, materials, and how they're carried
   - Include accessories, jewelry, or magical items with specific visual details

   **Magical/Distinctive Marks (when present):**
   - Describe tattoos, relics, scars, or magical markings with their appearance, location, and visual qualities

   **Format:** Write as flowing prose without bullet points, opening with a gender-identifying noun phrase and continuing through physical details, clothing, and equipment separated by semicolons. NO personality traits, backstory, or narrative context.

2. **SCENE DESCRIPTION**: Write step-by-step layered instructions that build the scene from back to front:
   - **Line 1:** State the art style and lighting as a single opening sentence{% if artStyle %} using "{{ artStyle }}" as the art style{% endif %} (e.g., "{% if artStyle %}{{ artStyle }}{% else %}Polished semi-realistic digital illustration{% endif %} at dusk.")
   - **Then write one paragraph per layer**, working from background to foreground. Each paragraph is a step that begins with a transition word ("First," "Next," "Then," "Finally,") and describes:
     - The spatial layer and position (e.g., "in the background," "in the mid-ground on the left," "at the foreground center at the largest scale")
     - What to place there: environment details first, then characters
     - For characters: include 2-3 key visual identifiers in parentheses (e.g., gender, hair, distinctive feature) and describe their pose/action briefly
   - **Keep every character's body visually separate.** No embracing, holding hands, linking arms, carrying another character, or any pose where bodies overlap or merge. Express relationships through proximity, facing direction, gestures, and expressions instead — allies can stand near each other, enemies can glare or raise weapons, but each figure must have a clean, unobstructed silhouette
   - **Group related characters in the same step** when they share a spatial layer
   - Use natural prose, not bullet points — each step reads as a directive sentence or short paragraph
   - End with any global notes (e.g., "All characters positioned at 3/4 angles toward viewer.")

3. **ALL CHARACTERS MUST BE INCLUDED**:
   - Every character provided in the input MUST appear in both the \`<characters>\` list AND the \`<scene>\` positioning
   - Do not omit any characters, even if there are many
   - If space is limited, place additional characters in background zones, but they must all appear

---

## PROCESS

{% if relatedEntities and relatedEntities.length > 0 %}
1. **Look up visual details** for items characters wear or carry using the \`lookup_related_entity_appearance\` tool. Focus on weapons, armor, magical items, and distinctive accessories. Batch lookups for efficiency.
2. **Analyze relationships** to determine character groupings and spatial dynamics
{% else %}
1. **Analyze relationships** to determine character groupings and spatial dynamics
{% endif %}
2. **Plan the scene layers** (background, mid-ground, foreground) and assign characters to layers based on narrative importance and relationship clusters. Characters are provided in order of importance (most important first). Place the first 2-3 characters in the foreground at largest scale; distribute remaining characters across mid-ground and background layers. Ensure every character is posed independently with visible space between them — convey dynamics through stance, gaze, and gesture rather than physical contact.
3. **Write the structured output** with:
   - \`<characters>\`: One \`<character id="id">\` element per character with detailed visual description incorporating looked-up item details
   - \`<scene>\`: Step-by-step layered instructions building the scene from background to foreground, one paragraph per layer

Write your complete scene description now inside \`<scene_description>\` tags, following the format requirements exactly:`;

export default createPrompt(meta, prompt);
