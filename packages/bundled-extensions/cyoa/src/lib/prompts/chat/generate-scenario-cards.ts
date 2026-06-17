import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const CharacterSchema = v.object({
  id: v.string(),
  name: v.string(),
  // From bookEntity.pronouns, typically like "he/him", "she/her", "they/them".
  pronouns: v.nullable(v.string())
});

const InputSchema = v.object({
  // Player is always the POV "you" in hooks.
  playerCharacter: CharacterSchema,

  // 0 => solo cards; 1 => dyad cards; 2+ => ensemble cards.
  otherCharacters: v.array(CharacterSchema),
  firstOtherCharacter: v.nullable(CharacterSchema),
  secondOtherCharacter: v.nullable(CharacterSchema),
  mode: v.picklist(['solo', 'dyad', 'ensemble']),

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

  // Relationship arcs can exist even with 3+ characters; use them when relevant.
  relationshipArcSnapshots: v.array(
    v.object({
      id: v.string(),
      title: v.string(),
      characterNames: v.string(),
      chapterRange: v.string(),
      content: v.string()
    })
  ),

  // Optional fallback signal when relationship arcs are sparse/missing.
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
  name: 'Generate Trope Cards',
  input: InputSchema
};

const prompt = `You are a Narrative UX Designer for a fan-fiction engine.

Your job is to distill narrative arcs into fast, high-clarity "Trope Cards" that let a user pick a story dynamic in seconds.

Do NOT summarize plot. Sell the feeling.
No modern slang. No named copyrighted settings. Keep it "generic fantasy-land" (keeps, guilds, courts, caravans, temples, wards).

Write hooks in present tense, second person ("you").

The hook is always written from the PLAYER character's POV:
- "you" = {{ playerCharacter.name }}
- Refer to OTHER characters by name (third person). Use their name, not just pronouns, so the hook is clear even without prior context.

<characters>
<character role="player" name="{{ playerCharacter.name }}" pronouns="{{ playerCharacter.pronouns }}" />
{% for character in otherCharacters %}
<character role="other" name="{{ character.name }}" pronouns="{{ character.pronouns }}" />
{% endfor %}
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
Generate 2 distinct Trope Cards.
{% else %}
Generate 4 distinct Trope Cards.
{% endif %}

Each card must:
- Be based on ONE clear dynamic (a single dominant trope). Do not blend unrelated tropes into one card.
- Be grounded in the selected location: pick a \`location_arc_id\` from \`<location_snapshots>\` FIRST, then find character/relationship arcs whose dynamics work at that location. The hook should feel like it happens THERE, not at some other place from the characters' history.
- Map back to the exact arc IDs you used (so the system can trace provenance).
- Create immediate tension without resolving it.

### What A Trope Card Contains
For each card, emit:
- \`<trope_name>\`: a 2-4 word fan-fiction trope title (no location names, no proper nouns, no purple prose).
- \`<tags>\` containing exactly 3 \`<tag>\` elements (no #). No duplicates. Use simple words like "Angst", "Danger", "Slow Burn".
- \`<hook>\`: one hard-hitting sentence (max 18 words) that sells the dynamic (not plot summary).
- \`<character_arc_ids>\` containing one \`<character_arc_id>\` per character arc you used to ground internal state for this card.
- \`<appearance_arc_ids>\` containing one \`<appearance_arc_id>\` per character, parallel to \`<character_arc_ids>\`. Pick the appearance from \`<appearance_arc_snapshots>\` that best matches the Trope Card.
- \`<relationship_arc_id>\`: the relationship arc ID you used. Omit this element entirely if you didn't use one.
- \`<location_arc_id>\`: the location arc ID you used (required).

### Arc Compatibility (Keep It Plausible)
- **Location is the scene anchor.** Pick the location arc FIRST, then select character and relationship arcs that make sense AT that location. The hook must depict a dynamic that could plausibly happen in the selected location right now.
- Do NOT import landmarks, architecture, or setting details from character/relationship arcs that reference a different location. For example, if a character arc mentions a throne room but the selected location is a harbor, the hook must not contain a throne room.
- Prefer character and relationship arcs whose chapter ranges overlap with events at or near the selected location. If no arcs overlap perfectly, adapt the emotional dynamic to the location rather than the other way around.
- If you set \`relationship_arc_id\`, only combine character/relationship snapshots with overlapping chapter ranges.
- Always translate the arc's dynamic into the player's POV: keep "you" = {{ playerCharacter.name }}, even if source text frames the other character's feelings.

### Style Constraints (Hard)
- Avoid proper nouns unless they appear in the provided snapshots/entities.
- No mention of chapter numbers in the hook.
- Hooks must be 18 words or fewer.
- Hooks must be exactly one sentence (no semicolons/colons; no line breaks).
- Hooks should use at most one comma.
- Never refer to the player in third person (no "he/she/they" for the player); the player is always "you".
- Do not write atmosphere or scenic description. No "rain-slicked", "gust-whipped", "sulfur-scented", etc.
- Never reference locations, landmarks, or settings absent from the selected location's snapshots. The hook's implied setting must match the selected location.
- Avoid stacked adjectives and metaphors. Prefer one concrete action + one immediate consequence.
- If your hook is too long, delete words until it fits. Do not split into multiple sentences.
- Avoid "You stand/You are/You see" openers. Start with intent, threat, demand, temptation, or an impossible choice.
{% if mode == "solo" %}
- Solo mode: do not write "you and him/her". Use "someone/they/a stranger/a rival" if needed.
{% elif mode == "dyad" %}
- Dyad mode: always use {{ firstOtherCharacter.name }} by name in the hook so it reads clearly on its own. Pronouns may follow a name reference within the same hook for flow, but the name must appear.
- Prefer to make "you" the subject/agent of the sentence when it fits the dynamic (your threat, your temptation, your choice).
- When using pronouns after the name: {{ firstOtherCharacter.pronouns }}. If pronouns are missing/unclear, default to they/them/their.
- Pronoun rule: when pronouns look like "he/him", treat the first as subject ("he") and second as object ("him"); use the matching possessive ("his").
- Perspective reminder: "you" is always {{ playerCharacter.name }}. Third-person references always mean {{ firstOtherCharacter.name }}.
- Some relationship arcs may involve additional characters beyond the selected pair. Refer to any unselected character(s) by name.
{% else %}
- Ensemble mode (3+ characters): the hook must name at least two other characters explicitly (use their provided names) to avoid ambiguity.
{% endif %}

## Output Format

{% if userPrompt %}
Output a single \`<trope_cards>\` root element containing 2 distinct \`<trope_card>\` children.
{% else %}
Output a single \`<trope_cards>\` root element containing 4 distinct \`<trope_card>\` children.
{% endif %}

{% if mode == "solo" %}
\`\`\`xml
<trope_cards>
  <trope_card>
    <trope_name>The Door Won't Open</trope_name>
    <tags>
      <tag>Dread</tag>
      <tag>Mystery</tag>
      <tag>Isolation</tag>
    </tags>
    <hook>Something in the dark knows your name, and the only exit just vanished.</hook>
    <character_arc_ids>
      <character_arc_id>C-EX-1</character_arc_id>
    </character_arc_ids>
    <appearance_arc_ids>
      <appearance_arc_id>A-EX-1</appearance_arc_id>
    </appearance_arc_ids>
    <location_arc_id>P-EX-1</location_arc_id>
  </trope_card>
</trope_cards>
\`\`\`
{% elif mode == "dyad" %}
\`\`\`xml
<trope_cards>
  <trope_card>
    <trope_name>Edge of Mercy</trope_name>
    <tags>
      <tag>Predator / Prey</tag>
      <tag>Power Imbalance</tag>
      <tag>Threat</tag>
    </tags>
    <hook>{{ firstOtherCharacter.name }} offers mercy on their terms, and you hate how much you need it.</hook>
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
    <trope_name>Shattered Vows</trope_name>
    <tags>
      <tag>Betrayal</tag>
      <tag>Angst</tag>
      <tag>Groveling</tag>
    </tags>
    <hook>You love {{ firstOtherCharacter.name }}, but every promise they broke still echoes between you.</hook>
    <character_arc_ids>
      <character_arc_id>C-EX-1</character_arc_id>
      <character_arc_id>C-EX-2</character_arc_id>
    </character_arc_ids>
    <appearance_arc_ids>
      <appearance_arc_id>A-EX-1</appearance_arc_id>
      <appearance_arc_id>A-EX-2</appearance_arc_id>
    </appearance_arc_ids>
    <relationship_arc_id>R-EX-2</relationship_arc_id>
    <location_arc_id>P-EX-2</location_arc_id>
  </trope_card>
</trope_cards>
\`\`\`
{% else %}
\`\`\`xml
<trope_cards>
  <trope_card>
    <trope_name>Three-Way Standoff</trope_name>
    <tags>
      <tag>Tension</tag>
      <tag>Politics</tag>
      <tag>Secrets</tag>
    </tags>
    <hook>{{ firstOtherCharacter.name }} demands truth, {{ secondOtherCharacter.name }} offers lies, and you must choose who to believe.</hook>
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
\`\`\`
{% endif %}`;

export default createPrompt(meta, prompt);
