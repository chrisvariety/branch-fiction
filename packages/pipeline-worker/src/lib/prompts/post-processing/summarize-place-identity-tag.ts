import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const ArcSchema = v.object({
  title: v.string(),
  content: v.string()
});

const InputSchema = v.object({
  places: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      arcs: v.array(ArcSchema),
      tier: v.picklist(['HUB', 'LOCALE', 'MICRO']),
      parentLocation: v.optional(v.string())
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Summarize Place Identity Tags',
  input: InputSchema
};

const prompt = `You will be creating short "Identity Tags" for a hierarchy of locations from a fantasy novel. Each tag should capture the location's core identity in a single, concise sentence.

## Location Hierarchy

You will analyze the following locations. This includes parent locations (HUBs like "Thornhaven") and their sub-locations (LOCALEs like "Training Quarter" or MICROs like "practice arena").

Each location includes story arcs that describe how the place appears and functions throughout the narrative—its atmosphere, physical details, and the key events or activities that occur there.

<locations>
{% for place in places %}
<location id="{{ place.friendlyId }}" tier="{{ place.tier }}"{% if place.parentLocation %} parent="{{ place.parentLocation }}"{% endif %}>
  <name>{{ place.name }}</name>
  <story_arcs>
  {% for arc in place.arcs %}
    <arc>
      <title>{{ arc.title }}</title>
      <content>{{ arc.content }}</content>
    </arc>
  {% endfor %}
  </story_arcs>
</location>
{% endfor %}
</locations>

## Task

For each location, create an identity tag by following these steps:

### Step 1: Identify the Function
What is this place used for? Examples:
- Training, sleeping, ruling, gathering, worship, defense, commerce, healing

### Step 2: Identify the Atmosphere
Choose an evocative adjective that captures the place's feel. Examples:
- Brutal, opulent, claustrophobic, sacred, weathered, imposing, serene, chaotic

### Step 3: Apply the Anchor Rule

**IF tier = "HUB":** Describe its Primary Purpose in the World
- Focus on what this place IS and what it's FOR in the broader setting
- Example: "Weathered guild hall where sworn defenders gather beneath century-old campaign banners."

**IF tier = "LOCALE" or "MICRO":** Anchor to the Parent Location and describe the Key Activity
- Reference the parent location and explain what happens here
- Example: "Cavernous main chamber within the guild hall where recruits swear their oaths by hearthlight."

## Identity Tag Structure

Each identity tag should be:
- A single sentence (typically 8-15 words)
- Begin with an atmosphere adjective or physical descriptor
- Include the location's function or purpose
- For non-HUBs: Reference the parent location naturally

### Examples of Well-Formed Identity Tags

**HUB locations (anchor to world/purpose):**
- "Ancient guild hall where sworn defenders gather beneath faded campaign banners."
- "Imposing mountain stronghold serving as the order's primary training grounds."
- "Sacred temple complex housing the realm's most powerful wards and relics."

**LOCALE locations (anchor to parent):**
- "Soot-stained hearth chamber within the guild hall where recruits take their oaths."
- "Vaulted armory beneath the stronghold storing weapons from a hundred campaigns."
- "Quiet meditation garden behind the temple where initiates commune with the divine."

**MICRO locations (anchor to parent):**
- "Scarred oak table in the guild hall's main chamber used for strategy meetings."
- "Narrow window alcove in the armory offering views of the mountain pass below."
- "Moss-covered shrine at the garden's center marking the temple's founding."

## Output Format

Return your response as XML with an identity tag for each location:

<identity_tags>
  <identity_tag id="guild_hall">Ancient guild hall where sworn defenders gather beneath faded campaign banners.</identity_tag>
  <identity_tag id="guild_hall_hearth">Soot-stained hearth chamber within the guild hall where recruits take their oaths.</identity_tag>
</identity_tags>

## Guidelines

- Match each identity tag to its location's id
- Ensure HUB tags stand alone and describe world significance
- Ensure LOCALE and MICRO tags reference their parent location
- Capture both physical character (appearance/condition) and functional purpose
- Keep tags concise but evocative—every word should earn its place
- Avoid generic descriptions; each tag should feel specific to THIS location`;

export default createPrompt(meta, prompt);
