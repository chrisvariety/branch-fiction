import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  places: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      description: v.nullable(v.string()),
      attributes: v.array(
        v.object({
          category: v.string(),
          name: v.string(),
          value: v.string(),
          evidence: v.string()
        })
      )
    })
  ),
  relationships: v.array(
    v.object({
      source_id: v.string(),
      source_name: v.string(),
      predicate: v.string(),
      target_id: v.string(),
      target_name: v.string(),
      description: v.string()
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Hierarchy',
  input: InputSchema
};

const prompt = `You are an expert Spatial Taxonomist for a fantasy narrative engine. Your goal is to organize a list of locations into a strict 5-Tier Hierarchy based on their narrative scope and spatial relationships.

You will be provided with a list of locations and their extracted attributes (Physical, Spatial, Functional, etc.). You must analyze each location and classify it into the appropriate tier. If the provided attributes are insufficient to determine a location's tier, assign it to Tier 0 (Unknown).

## The 5-Tier Hierarchy

You must assign every location to exactly one of these Tiers:

**Tier 0: Unknown**
* **Scope:** Locations where the provided attributes are insufficient to determine the correct tier.
* **Indicators:** Vague descriptions, missing spatial relationships, insufficient context about scale or function.
* **Function:** A temporary classification indicating more information is needed to properly classify this location.

**Tier 1: The Realm (Macro)**
* **Scope:** Kingdoms, Continents, Large Geographical Regions, Empires, Provinces.
* **Indicators:** Maps, borders, politics, "The Northern Territories," "The Kingdom of X," "The Continent of Y."
* **Function:** The container for the entire story or major story arcs.

**Tier 2: The Hub (Primary Setting)**
* **Scope:** Cities, Towns, Major Outposts, Castles, Estates, Academies, Fortresses, Ships (if they are the main setting).
* **Indicators:** Places where characters sleep, live, and socialize between events. It is a "Home Base" where people reside.
* **Function:** The primary selection for a user to say "I want to be *here*." A place with multiple functional areas.

**Tier 3: The Locale (Scene)**
* **Scope:** Distinct buildings, functional areas, or landmarks *within* or *near* a Hub.
* **Indicators:** "The Training Grounds," "The Great Library," "The Market Square," "The Tavern," "The Armory."
* **Function:** A specific place to perform an action (fight, study, trade, eat, worship).

**Tier 4: The Micro (Intimacy)**
* **Scope:** A single room, a specific corner, a piece of furniture, or a small confined space.
* **Indicators:** "The Captain's Quarters," "The Council Chamber," "A storage closet," "The throne," "A private study."
* **Function:** Intimate conversations, secrets, or specific interactions. Personal spaces.

## Input Data

Here are the location profiles to classify:

<locations>
{% for place in places %}
<location id="{{ place.id }}" name="{{ place.name }}">
{% if place.description %}
  <description>{{ place.description }}</description>
{% endif %}

  <attributes>
{% for attribute in place.attributes %}
  {{ attribute.name }}: {{ attribute.value }} ({{ attribute.evidence }})
{% endfor %}
  </attributes>
</location>
{% endfor %}
</locations>

{% if relationships and relationships.length > 0 %}
<place_relationships>
These are explicit place-to-place relationships extracted from the narrative. When one place IS_PART_OF, IS_LOCATED_IN, or is contained by another, that directly indicates a parent-child link; use these as the strongest signal for parent_id.

{% for rel in relationships %}
  ({{ rel.source_id }}) {{ rel.source_name }} -[{{ rel.predicate }}]-> ({{ rel.target_id }}) {{ rel.target_name }}: {{ rel.description }}
{% endfor %}
</place_relationships>
{% endif %}

## Your Task

For each location in the provided data:

{% if relationships and relationships.length > 0 %}
1.  **Analyze Scope:** Review specific attributes like "Structure Type," "Parent Location," "Contains," and any descriptive text to determine the scale and function. Then, cross-reference the \`<place_relationships>\` block — these are explicit narrative relationships extracted directly from the source material and carry the strongest signal for determining parent-child links. Pay particular attention to predicates like \`IS_PART_OF\`, \`IS_LOCATED_IN\`, or any containment relationship, as these directly indicate hierarchy. Where attribute-based inference and relationship data conflict, prefer the relationship data.
{% else %}
1.  **Analyze Scope:** Review specific attributes like "Structure Type," "Parent Location," "Contains," and any descriptive text to determine the scale and function.
{% endif %}
2.  **Assign Tier:** Classify the location into Tier 0, 1, 2, 3, or 4 based on the definitions above. Use Tier 0 only when the provided attributes are genuinely insufficient to make a confident classification.
3.  **Determine Parent:** Identify the immediate "Parent" of this location to establish a hierarchical connection.
    * **Strict ID Matching:** If the parent location exists in the provided \`<locations>\` list, you MUST use its exact \`id\`.
    * If the parent is not in the list, set \`parent_id\` to null.
4.  **Provide Reasoning:** Explain briefly why you assigned this tier based on the location's attributes and function.

## Logic Rules for Classification

* **The "Hub" Test:** Can a large group of people live here indefinitely (sleep, eat, train, work)? If yes -> Tier 2. Is it just for a specific activity or function? If yes -> Tier 3.
* **The "Room" Test:** Is this a single room or small enclosed space within a larger building? If yes -> Tier 4.
* **Upward Inference:** If a location is described as a "room" or "chamber" (Tier 4), look for what building it is in (Tier 3). If a building is described, look for what settlement it is in (Tier 2). Natural features (mountains, rivers, forests), war fronts, training grounds, and outposts that sit *near* or *between* settlements should still link to the HUB they are most directly associated with — the settlement whose characters live near, defend, traverse, train at, or operate from them — rather than being left parentless.
* **Relationship-Driven Parents:** If \`<place_relationships>\` shows one place \`IS_PART_OF\`, \`IS_LOCATED_IN\`, or is contained by another, prefer that as the parent link (subject to the tier rules — the parent must be a higher tier than the child).
* **Context Clues:**
  * Attributes like "capital city," "fortress," "academy," "village" indicate Tier 2
  * Attributes like "continent," "kingdom," "province," "region" indicate Tier 1
  * Attributes like "building," "hall," "field," "square" indicate Tier 3
  * Attributes like "room," "office," "quarters," "chamber" indicate Tier 4
* **Scale Matters:** Consider the relative size and whether the location contains other locations or is contained by them.

## Output

For each location in the input, call the \`classify_location\` tool. The tool takes:
- \`id\`: the exact location id from the input
- \`tier\`: integer 0–4 (0=Unknown, 1=Realm, 2=Hub, 3=Locale, 4=Micro)
- \`tier_label\`: matching string (must agree with \`tier\`)
- \`parent_id\`: the id of the parent location from the input, or null
- \`reasoning\`: a brief explanation

You may call \`classify_location\` again for the same id if you realize an earlier classification was wrong — later calls overwrite earlier ones.

## Critical Ordering Rule

**Classify top-down: Realms first, then Hubs, then Locales, then Micros.** The tool enforces two rules at call time and will reject calls that violate them:

1. A child's \`parent_id\` must reference a location that has **already been classified**. Classify parents before children.
2. The parent's tier number must be **strictly less than** the child's tier number. Examples:
   - A Hub (tier 2) MAY have a Realm (tier 1) parent. MUST NOT have another Hub (tier 2) as parent.
   - A Locale (tier 3) MAY have a Hub (tier 2) or Realm (tier 1) parent. MUST NOT have another Locale.
   - A Realm (tier 1) MUST have \`parent_id=null\`.

If two locations both look like Hubs and one contains the other (e.g. a city contains a quarter, a castle contains a wing), the contained one is a Locale — reclassify it as a Locale rather than violating the tier rule. City quarters, neighborhoods, wards, districts, and named campus buildings are Locales within their parent Hub, not Hubs themselves.

## Example

Given Eldoria Kingdom, Silverkeep Academy, the Grand Library, the Headmaster's Office, classify top-down:

1. \`classify_location(id="eldoria_kingdom", tier=1, tier_label="Realm", parent_id=null, reasoning="...")\`
2. \`classify_location(id="silverkeep", tier=2, tier_label="Hub", parent_id="eldoria_kingdom", reasoning="...")\`
3. \`classify_location(id="grand_library", tier=3, tier_label="Locale", parent_id="silverkeep", reasoning="...")\`
4. \`classify_location(id="headmaster_office", tier=4, tier_label="Micro", parent_id="grand_library", reasoning="...")\`

## Final Requirements

Call \`classify_location\` for **every** location in the input. If a location is genuinely ambiguous, use tier=0 (Unknown) with parent_id=null.`;

export default createPrompt(meta, prompt);
