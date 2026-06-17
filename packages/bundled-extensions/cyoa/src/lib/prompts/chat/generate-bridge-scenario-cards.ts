import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const CharacterSchema = v.object({
  id: v.string(),
  name: v.string(),
  pronouns: v.nullable(v.string())
});

const InputSchema = v.object({
  // Player is always the POV "you" in hooks.
  playerCharacter: CharacterSchema,
  otherCharacter: CharacterSchema,

  // Required in this prompt variant (and absent in the non-bridge prompt).
  bridgeCharacterName: v.string(),
  bridgeRelationshipArcSnapshots: v.array(
    v.object({
      id: v.string(),
      title: v.string(),
      characterNames: v.string(),
      chapterRange: v.string(),
      content: v.string()
    })
  ),

  selectedLocation: v.object({
    id: v.string(),
    name: v.string()
  }),

  characterArcSnapshots: v.array(
    v.object({
      id: v.string(),
      characterName: v.string(),
      title: v.string(),
      chapterRange: v.string(),
      content: v.string()
    })
  ),

  appearanceArcSnapshots: v.array(
    v.object({
      id: v.string(),
      characterName: v.string(),
      title: v.string(),
      chapterRange: v.string(),
      content: v.string()
    })
  ),

  relationshipArcSnapshots: v.array(
    v.object({
      id: v.string(),
      title: v.string(),
      characterNames: v.string(),
      chapterRange: v.string(),
      content: v.string()
    })
  ),

  rawRelationships: v.array(v.string()),

  locationSnapshots: v.array(
    v.object({
      id: v.string(),
      locationName: v.string(),
      title: v.string(),
      content: v.string()
    })
  ),

  relatedEntities: v.array(
    v.object({
      name: v.string(),
      description: v.nullable(v.string())
    })
  ),

  // Optional user-provided prompt to guide scenario generation (e.g. "What if Nick never left?")
  userPrompt: v.nullable(v.string())
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Generate Trope Cards (Bridge)',
  input: InputSchema
};

const prompt = `You are a Narrative UX Designer for a fan-fiction engine.

Your job is to distill narrative arcs into fast, high-clarity "Trope Cards" that let a user pick a story dynamic in seconds.

Do NOT summarize plot. Sell the feeling.
No modern slang. No named copyrighted settings. Keep it "generic fantasy-land" (keeps, guilds, courts, caravans, temples, wards).

Write hooks in present tense, second person ("you").

The hook is always written from the PLAYER character's POV:
- "you" = {{ playerCharacter.name }}
- any third-person pronouns or names refer to OTHER characters, never the player

There is a bridge character available: {{ bridgeCharacterName }}. They are a facilitator/complicator, not the main romantic lead by default.

<characters>
<character role="player" name="{{ playerCharacter.name }}" pronouns="{{ playerCharacter.pronouns }}" />
<character role="other" name="{{ otherCharacter.name }}" pronouns="{{ otherCharacter.pronouns }}" />
<character role="bridge" name="{{ bridgeCharacterName }}" />
</characters>

<selected_location name="{{ selectedLocation.name }}" tier="top-level" />

<character_arc_snapshots>
{% for arc in characterArcSnapshots %}
<character_arc id="{{ arc.id }}" character="{{ arc.characterName }}">
  <chapter_range>{{ arc.chapterRange }}</chapter_range>
  <content>{{ arc.content }}</content>
</character_arc>
{% endfor %}
</character_arc_snapshots>

<appearance_arc_snapshots>
{% for arc in appearanceArcSnapshots %}
<appearance_arc id="{{ arc.id }}" character="{{ arc.characterName }}">
  <chapter_range>{{ arc.chapterRange }}</chapter_range>
  <content>{{ arc.content }}</content>
</appearance_arc>
{% endfor %}
</appearance_arc_snapshots>

{% if relationshipArcSnapshots.length > 0 %}
<relationship_arc_snapshots>
{% for arc in relationshipArcSnapshots %}
<relationship_arc id="{{ arc.id }}">
  <characters>{{ arc.characterNames }}</characters>
  <chapter_range>{{ arc.chapterRange }}</chapter_range>
  <content>{{ arc.content }}</content>
</relationship_arc>
{% endfor %}
</relationship_arc_snapshots>
{% else %}
{% if rawRelationships.length > 0 %}
<raw_relationships>
{% for rel in rawRelationships %}
{{ rel }}
{% endfor %}
</raw_relationships>
{% endif %}
{% endif %}

<bridge_relationship_arc_snapshots>
{% for arc in bridgeRelationshipArcSnapshots %}
<relationship_arc id="{{ arc.id }}">
  <title>{{ arc.title }}</title>
  <characters>{{ arc.characterNames }}</characters>
  <chapter_range>{{ arc.chapterRange }}</chapter_range>
  <content>{{ arc.content }}</content>
</relationship_arc>
{% endfor %}
</bridge_relationship_arc_snapshots>

<location_snapshots>
{% for arc in locationSnapshots %}
<location_arc id="{{ arc.id }}" location="{{ arc.locationName }}">
  <title>{{ arc.title }}</title>
  <content>{{ arc.content }}</content>
</location_arc>
{% endfor %}
</location_snapshots>

{% if relatedEntities and relatedEntities.length > 0 %}
<related_entities>
{% for entity in relatedEntities %}
<entity name="{{ entity.name }}">{{ entity.description }}</entity>
{% endfor %}
</related_entities>
{% endif %}

{% if userPrompt %}
## User Creative Direction

The user has provided a "what if" prompt to guide the scenarios. Treat this as the PRIMARY creative direction — every card should explore or riff on this premise using the available arcs. Find arcs that are most relevant to the user's prompt and build cards around them.

<user_prompt>{{ userPrompt }}</user_prompt>
{% endif %}

## Task

{% if userPrompt %}
Generate 2 distinct Trope Cards
{% else %}
Generate 3-5 distinct Trope Cards
{% endif %} for the core pairing ({{ playerCharacter.name }} + {{ otherCharacter.name }}), with a bridge option ({{ bridgeCharacterName }}).

Each card must:
- Be based on ONE clear dynamic (a single dominant trope).
- Always choose a \`location_arc_id\` from \`<location_snapshots>\`.
- Map back to the exact arc IDs you used (so the system can trace provenance).
- Create immediate tension without resolving it.

Across the set:
- Include 1-2 bridge cards where {{ bridgeCharacterName }} changes the dynamic (forces a truce, raises the stakes, reveals a secret, sets terms).
- The rest should focus on the core pairing without the bridge.

### What A Trope Card Contains
For each card, emit:
- \`<trope_name>\`: a 2-4 word fan-fiction trope title (no location names, no proper nouns, no purple prose).
- \`<tags>\` containing exactly 3 \`<tag>\` elements (no #). No duplicates. Use simple words like "Angst", "Danger", "SlowBurn".
- \`<hook>\`: one hard-hitting sentence (max 18 words) that sells the dynamic (not plot summary).
- \`<character_arc_ids>\` containing one \`<character_arc_id>\` per character arc you used to ground internal state for this card.
- \`<appearance_arc_ids>\` containing one \`<appearance_arc_id>\` per character, parallel to \`<character_arc_ids>\`. Pick the appearance from \`<appearance_arc_snapshots>\` that best matches the Trope Card.
- \`<relationship_arc_id>\`: the relationship arc ID you used. Omit this element entirely if you didn't use one.
- \`<location_arc_id>\`: the location arc ID you used (required).

### Arc Compatibility (Keep It Plausible)
- If you set \`relationship_arc_id\`, only combine character/relationship snapshots with overlapping chapter ranges.
- Always pick character arcs that fit the chosen location arc's phase/flavor.
- Always translate the arc's dynamic into the player's POV: keep "you" = {{ playerCharacter.name }}, even if source text frames the other character's feelings.

### Style Constraints (Hard)
- Avoid proper nouns unless they appear in the provided snapshots/entities.
- No mention of chapter numbers in the hook.
- Hooks must be 18 words or fewer.
- Hooks must be exactly one sentence (no semicolons/colons; no line breaks).
- Hooks should use at most one comma.
- Never refer to the player in third person (no "he/she/they" for the player); the player is always "you".
- Do not write atmosphere or scenic description. No "rain-slicked", "gust-whipped", "sulfur-scented", etc.
- Avoid stacked adjectives and metaphors. Prefer one concrete action + one immediate consequence.
- Prefer to make "you" the subject/agent of the sentence when it fits the dynamic (your threat, your temptation, your choice).
- If your hook is too long, delete words until it fits. Do not split into multiple sentences.
- Avoid "You stand/You are/You see" openers. Start with intent, threat, demand, temptation, or an impossible choice.
- For non-bridge cards, prefer pronoun-based hooks for {{ otherCharacter.name }}. Use the name only when it improves clarity or impact.
- {{ otherCharacter.name }} pronouns (if known): {{ otherCharacter.pronouns }}. If unclear, default to they/them/their.
- Pronoun rule: when pronouns look like "he/him", treat the first as subject and second as object; use the matching possessive (his/her/their/its).
- Note: examples below use they/them/their; in actual output, match the provided pronouns when possible.
- For bridge cards, you must name {{ bridgeCharacterName }} explicitly in the hook.
- Perspective reminder: "you" is always {{ playerCharacter.name }}. If you write "he/she/they", it must refer to {{ otherCharacter.name }}.

## Output Format

{% if userPrompt %}
Output a single \`<trope_cards>\` root element containing 2 distinct \`<trope_card>\` children.
{% else %}
Output a single \`<trope_cards>\` root element containing 3-5 distinct \`<trope_card>\` children.
{% endif %}

\`\`\`xml
<trope_cards>
  <trope_card>
    <trope_name>Edge of Mercy</trope_name>
    <tags>
      <tag>PredatorPrey</tag>
      <tag>PowerImbalance</tag>
      <tag>Threat</tag>
    </tags>
    <hook>They offer you mercy on their terms, and you hate how badly you need it.</hook>
    <character_arc_ids>
      <character_arc_id>C-EX-1</character_arc_id>
      <character_arc_id>C-EX-2</character_arc_id>
    </character_arc_ids>
    <appearance_arc_ids>
      <appearance_arc_id>A-EX-1</appearance_arc_id>
      <appearance_arc_id>A-EX-2</appearance_arc_id>
    </appearance_arc_ids>
    <relationship_arc_id>R-EX-1</relationship_arc_id>
    <location_arc_id>P-EX-1</location_arc_id>
  </trope_card>
  <trope_card>
    <trope_name>Forbidden Sparks</trope_name>
    <tags>
      <tag>SexualTension</tag>
      <tag>Sparring</tag>
      <tag>SlowBurn</tag>
    </tags>
    <hook>Your blades lock as {{ bridgeCharacterName }} calls it training and {{ otherCharacter.name }} watches your mouth.</hook>
    <character_arc_ids>
      <character_arc_id>C-EX-1</character_arc_id>
      <character_arc_id>C-EX-2</character_arc_id>
      <character_arc_id>C-EX-3</character_arc_id>
    </character_arc_ids>
    <appearance_arc_ids>
      <appearance_arc_id>A-EX-1</appearance_arc_id>
      <appearance_arc_id>A-EX-2</appearance_arc_id>
      <appearance_arc_id>A-EX-3</appearance_arc_id>
    </appearance_arc_ids>
    <relationship_arc_id>R-EX-3</relationship_arc_id>
    <location_arc_id>P-EX-3</location_arc_id>
  </trope_card>
</trope_cards>
\`\`\``;

export default createPrompt(meta, prompt);
