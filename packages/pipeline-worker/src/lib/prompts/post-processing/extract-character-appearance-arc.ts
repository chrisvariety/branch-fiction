import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

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
  relatedEntityArcs: v.optional(
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
  appearanceHints: v.optional(
    v.array(
      v.object({
        name: v.string(),
        value: v.string(),
        source: v.picklist(['explicit', 'inferred'])
      })
    )
  ),
  minorUntilChapterIdx: v.optional(v.number())
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Character Appearance Arc',
  input: InputSchema
};

const prompt = `You are an expert Concept Artist and Character Designer. Your task is to distill a collection of raw entity attributes, gathered chronologically from a novel, into an "appearance arc" that tracks how a character's visual appearance evolves throughout the story.

<character_data>
ID: {{ character.friendlyId }}
Name: {{ character.name }}

{% for attribute in attributes %}
Chapter {{ attribute.chapterIdx }}: {{ attribute.category }} - {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
{% endfor %}
</character_data>

{% if appearanceHints and appearanceHints.length > 0 %}
<appearance_hints>
The following core appearance attributes have been pre-analyzed from the character data. These should be treated as the primary source of truth for each attribute listed. When raw attributes in <character_data> conflict with these hints, please prioritize the appearance hint values.

{% for hint in appearanceHints %}
- **{{ hint.name }}**: {{ hint.value }}
{% endfor %}
</appearance_hints>
{% endif %}

{% if relatedEntityArcs and relatedEntityArcs.length > 0 %}
<related_entities>
The following entities are related to {{ character.name }} and may provide valuable context for creating a more cohesive visual description:

{% for entity in relatedEntityArcs %}
<entity id="{{ entity.friendlyId }}" type="{{ entity.type }}"{% if entity.phrasesUsed %} phrases="{{ entity.phrasesUsed }}"{% endif %}>{{ entity.summary }}</entity>
{% endfor %}
</related_entities>

You have access to the following tool:
* \`lookup_related_entity_appearance({id: string})\`: Retrieves detailed visual information about a related entity using its ID from the list above.

**When to Use the Tool**: Use \`lookup_related_entity_appearance\` to gather visual details about items {{ character.name }} is wearing/carrying (weapons, armor, magical items, distinctive accessories), architectural elements, or magical elements that would appear in the scene. This is CRITICAL for producing accurate visual descriptions.

**When NOT to Use the Tool**: Skip abstract concepts, generic references, or entities without direct visual presence in the scene.
{% endif %}

## Appearance Arc Concept

{% if minorUntilChapterIdx %}
**Important**: {{ character.name }} was a minor (child) until Chapter {{ minorUntilChapterIdx }}. When creating appearance snapshots:
- Start the first appearance at or after Chapter {{ minorUntilChapterIdx }} (when they become an adult)
- Do NOT create separate appearances for chapters before {{ minorUntilChapterIdx }}
- You MAY include brief references to their childhood appearance in the first snapshot's detail for context (e.g., "Having grown up with..."), but the snapshot itself should represent them as an adult
- Focus on their visual evolution from when they reach adulthood onward

{% endif %}
Characters in novels typically undergo visual transformations throughout the narrative. Your task is to identify and document distinct "appearance phases" that span the narrative. Each phase represents a visually stable period, bounded by **major changes** in the character's appearance.

### What Constitutes a "Major Change"

Create a new appearance entry when ANY of the following occur:

**Equipment & Attire Changes:**
- Acquiring or losing significant armor, weapons, or magical items (e.g., "dons full plate armor," "loses ancestral sword")
- Major wardrobe changes that signal transformation (e.g., "trades peasant rags for noble attire," "adopts religious vestments")
- Changes in characteristic accessories that define their look (e.g., "begins wearing a crown," "removes all jewelry")

**Physical Transformations:**
- Permanent injuries or disfigurement (e.g., "loses left arm," "scarred across face," "blinded in one eye")
- Amputations, significant burns, or magical curses affecting appearance
- Physical death or resurrection with altered form
- Aging that significantly changes their look (e.g., "hair turns white overnight," "body withers from dark magic")
- Shape-shifting or magical transformation (e.g., "transforms into a wolf," "cursed into stone form")

**Bodily Modifications:**
- New tattoos, brands, or magical marks of significance
- Drastic hair changes (e.g., "shaves head," "cuts off long braids," "hair burned away")
- Major weight loss or gain that alters silhouette
- Prosthetics or magical replacements for lost body parts

**Status Markers:**
- Visible signs of rank change (e.g., "promoted to general, wears insignia," "exiled and stripped of emblems")
- Ritual scarification or initiation marks
- Enslavement or imprisonment marks (e.g., "iron collar," "branded with slave mark")

### What to IGNORE (Not Major Changes)

**Temporary Conditions:**
- Temporary Dirt, blood, sweat, grime from travel or combat
- Temporary injuries: bruises, minor cuts, black eyes, split lips
- Temporary emotional states: flushed, pale, disheveled from fear/anger
- Temporary weather effects: soaked from rain, frost-covered, sunburned
- Exhaustion-related appearance: dark circles, slumped posture

**Minor Variations:**
- Daily outfit changes within the same style/social class
- Different hairstyles using the same hair length
- Minor accessory swaps that don't change overall impression
- Replacing equipment with similar items (e.g., "new sword of similar design")

### Output Format

Create an XML document with the following structure:

\`\`\`xml
<appearances>
  <appearance>
    <chapters>X-Y</chapters>
    <title>[Narratively descriptive phrase]</title>
    <detail>[Complete standalone visual description in flowing prose]</detail>
  </appearance>
  <appearance>
    <chapters>Z-W</chapters>
    <title>[Narratively descriptive phrase]</title>
    <detail>[Complete standalone visual description in flowing prose]</detail>
  </appearance>
</appearances>
\`\`\`

Each <appearance> element should contain:
1. **<chapters>**: Chapter range (e.g., "1-12", "15", "20+")
2. **<title>**: A narratively descriptive few words capturing the essence of this appearance (e.g., "A battle-worn warrior", "The farm laborer", "Corrupted fallen knight")
3. **<detail>**: A complete visual description written as flowing prose that integrates:
   - Overall visual archetype and impression
   - Height, body shape, build, and posture
   - Face shape, skin, eyes, hair, distinctive marks, and scars
   - Clothing layers, materials, colors, accessories, and equipment

   **For subsequent appearances**: Explicitly note what has changed from the previous appearance. Use phrases like "now wears", "has gained", "lost", etc. to clearly indicate transformations and build upon the previous description

### Description Guidelines

- Write in flowing, vivid prose using concrete adjectives and specific nouns. Use parentheses to group secondary details with the primary feature they belong to, keeping descriptions scannable rather than a flat stream of comma-separated traits. For example: "muscular arms (crisscrossed with old battle scars)" or "leather armor (reinforced with steel plates, etched with geometric patterns)" keeps related details clustered and prevents ambiguity about what modifies what.
- Focus exclusively on visual details that can be depicted
- Avoid abstract concepts, personality traits, or motivations unless they manifest physically (e.g., "a perpetual scowl" is acceptable)
- For in-world terms (e.g., 'relic', 'sigil'), you must provide a visual definition in parentheses immediately after the term first appears. For example: "...wears a silver glyph (a coin-sized magical symbol that glows faintly) on his lapel."
- Be specific with colors (e.g., "storm-gray," "emerald green," not just "blue" or "green")
- For appearances after the first one, clearly note what has changed to show the character's evolution

### Example Output

<appearances>
<appearance>
<chapters>1-7</chapters>
<title>The farm laborer</title>
<detail>
A young person of average height around 5'9" with a lean, wiry build (shaped by years of manual labor at Millbrook Farm), standing with slightly hunched shoulders from long hours of fieldwork. The face is oval with a soft jawline and rounded cheeks, lightly tanned skin (scattered with freckles across the nose and cheeks). Warm brown eyes (wide and expressive, thick lashes) peer out beneath sandy blonde hair (shoulder-length, wavy, often tied back with simple twine). The skin is sun-weathered but smooth, with no distinctive marks or scars.

For clothing, a rough-spun cream tunic (rolled sleeves) covers the torso, paired with brown canvas trousers (patches at the knees from frequent kneeling). Worn leather boots (thin soles) protect the feet. A simple rope belt cinches the waist, holding a small eating knife (inherited from their father, plain leather sheath). A woven straw hat is often carried or worn for sun protection during field work.
</detail>
</appearance>

<appearance>
<chapters>8-15</chapters>
<title>The armored squire</title>
<detail>
The same figure now stands at average height but with a notably more muscular build (through the shoulders and arms, from intensive weapons training under Knight-Commander Aldric). The posture has transformed from hunched fieldwork shoulders to military bearing—chin up, chest forward, straight and alert. The oval face retains its tanned, freckled skin but has developed harder angles as youth begins to fade, with a fresh scar (a thin pink line from left eyebrow to temple, earned during the Tournament of Blades). The brown eyes remain but carry a more guarded, watchful expression. The sandy blonde hair has been cut short to jaw-length for practicality beneath a helmet.

The rough homespun clothing is gone, replaced by a full set of training armor: a steel chainmail hauberk over a padded gambeson, steel vambraces (forearms) and greaves (lower legs). Brown leather boots (reinforced soles) have replaced the worn thin-soled ones. A white tabard bearing the blue falcon insignia (house colors signifying loyalty to House Ravens) drapes over the armor. The simple rope belt has been replaced by a wide leather belt holding a standard-issue longsword (leather-wrapped scabbard) on one hip and a dagger on the opposite side. A Sunstone (a polished amber-colored rock etched with a solar flare design, suspended on a leather thong) hangs around the neck, marking membership in the Vanguard. An iron ring on the right index finger identifies the wearer as a knighthood candidate.
</detail>
</appearance>

<appearance>
<chapters>16+</chapters>
<title>The corrupted outcast</title>
<detail>
The once-muscular figure has become gaunt (noticeably thinner, hollow cheeks, sharp facial angles) after exposure to the Void Sickness. Most dramatically, the left arm now ends abruptly at the elbow (severed by the Shadowblade, wrapped in crude bandages). The military bearing has collapsed into an asymmetrical posture, favoring the right side with a subtle forward lean. The face is haggard with sunken cheeks, the tanned, freckled skin now replaced by a grayish-pale undertone that has swallowed the freckles. The left eye has turned milky white and sightless (after the ritual at Blackmoor), while the right eye remains brown but haunted. The short blonde hair has grown out shaggy to the shoulders and gone prematurely gray-white, unwashed and tangled. The thin scar from eyebrow to temple remains, but is overshadowed by a curse-mark (black vein-like patterns resembling corrupted roots, pulsing faintly with dark magic) spreading from the left temple down the neck.

The training armor is gone—chainmail hauberk, vambraces, and greaves all shed after exile from the Vanguard. Only the padded gambeson remains (heavily stained and torn, left sleeve tied off where the arm ends). The white tabard with the blue falcon insignia has been discarded. A dark gray travel cloak (deep hood, often pulled up to conceal the ravaged face) now hangs from the shoulders. The leather belt remains but the training sword has been replaced by a scavenged blade (mounted on the back for easier right-hand draw), with the dagger repositioned on the left hip. The Sunstone and iron ring are gone—no ceremonial markers remain, just the bare essentials of a wanderer who has lost everything.
</detail>
</appearance>
</appearances>

{% if relatedEntityArcs and relatedEntityArcs.length > 0 %}
**Workflow**: Before writing your final appearance arc, review the related_entities list and use the \`lookup_related_entity_appearance\` tool to gather details about any entities that would enhance your description of {{ character.name }}'s appearance across different phases.
{% endif %}

Your response must be valid XML following the format above. Include as many <appearance> elements as needed to capture all major visual changes throughout the novel.`;

export default createPrompt(meta, prompt);
