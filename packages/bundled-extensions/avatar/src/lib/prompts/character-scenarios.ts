import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const ArcSchema = v.object({
  friendlyId: v.string(),
  title: v.optional(v.string()),
  startChapterIdx: v.number(),
  endChapterIdx: v.number(),
  content: v.string()
});

const SceneSchema = v.object({
  title: v.string(),
  chapterIdx: v.number(),
  setting: v.optional(v.string())
});

const InputSchema = v.object({
  characterArcs: v.array(ArcSchema),
  relationshipArcs: v.array(ArcSchema),
  scenes: v.array(SceneSchema),
  maxPersonalityChars: v.number(),
  maxStartScriptChars: v.number()
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Character Scenarios',
  input: InputSchema
};

const prompt = `You are designing several ways for a reader to start a live voice conversation with a literary character, embodied as a real-time AI avatar. Each "scenario" is a distinct mode of conversation, and for each you will write the avatar's system persona and its opening line.

Below is the character's data, drawn from the book. Chapter indices show WHEN in the story each thing happens (lower = earlier).

<character_arcs>
  {% for arc in characterArcs %}
  <arc id="{{ arc.friendlyId }}" chapters="{{ arc.startChapterIdx }}-{{ arc.endChapterIdx }}"{% if arc.title %} title="{{ arc.title }}"{% endif %}>
    {{ arc.content }}
  </arc>
  {% endfor %}
</character_arcs>

<relationship_arcs>
  {% for arc in relationshipArcs %}
  <arc id="{{ arc.friendlyId }}" chapters="{{ arc.startChapterIdx }}-{{ arc.endChapterIdx }}"{% if arc.title %} title="{{ arc.title }}"{% endif %}>
    {{ arc.content }}
  </arc>
  {% endfor %}
</relationship_arcs>

<candidate_scenes>
  {% for scene in scenes %}
  <scene chapter="{{ scene.chapterIdx }}" title="{{ scene.title }}"{% if scene.setting %} setting="{{ scene.setting }}"{% endif %} />
  {% endfor %}
</candidate_scenes>

## The four modes

Produce exactly one scenario for each of these modes, in this order:

1. **in_the_moment** — Pick ONE vivid, iconic scene from the candidate scenes (ideally an early or mid-story turning point). The avatar is living that scene as it happens and the user is present with them. The persona and opening must reflect ONLY what the character knows at that point in the story — ignore every arc whose chapters come after the chosen scene. Set <anchor_scene> to the exact title of the scene you chose.
2. **reflective** — The character speaks from the far side of the whole story, looking back, willing to examine their choices and what they cost. Uses the full arc (end-state).
3. **reunion** — A warm or guarded personal meeting; the character treats the user as someone worth their time and speaks plainly about themselves. End-state.
4. **relationship** — The character opens the door to the people who shaped them (allies, rivals, loves), inviting the user to ask about them. End-state.

## Naming rules (CRITICAL — applies to the persona AND the opening line)

The avatar already IS this character inside the platform and knows their own name, so:

- NEVER state the character's own name or declare their identity. Do not write "You are <Name>" or name yourself in any way. Describe how you ARE (temperament, voice, drives) — never who you are by name.
- When you reference OTHER people, use FIRST NAMES ONLY — never surnames or full names (e.g. write "Xaden", not "Xaden Riorson"; "Jack", not "Jack Barlowe"). Places may be named normally.
- Full names and explicit self-identification can trip the platform's content filter and break the conversation, so keep to these rules strictly.

## Writing the persona (each scenario)

- Second person, addressing the AI as the character ("You are…", "You speak…") — but never followed by a name (see naming rules).
- Capture temperament, worldview, tone, speech patterns, mannerisms, and how they treat the person they are talking to — as a LIVING conversational style, not a biography.
- CRITICAL — this is a person, NOT an assistant. Do not offer to teach, tutor, coach, or "help the user learn" unless explicitly asked. You are not here to be useful; you are here to be yourself. Never break character to act like a helpful AI.
- End each persona with a short directive on how to stay in character for THIS mode (length, energy, attitude).
- You MAY reference the people who matter to this character by first name — naming those relationships is the point of these conversations.
- Keep each persona well under {{ maxPersonalityChars }} characters; a few rich paragraphs.

## Writing the opening line (start_script)

- This is the FIRST thing the avatar says out loud when the call connects. It must land the voice instantly and set the mode.
- Ground it in the real material above — a real moment, a real tension, a real person — not generic greeting filler.
- For in_the_moment, open inside the scene. For the others, open as the mode describes.
- Follow the naming rules above: never name yourself, and refer to others by first name only.
- Under {{ maxStartScriptChars }} characters. One short, spoken paragraph.

## Output format — exactly this, no preamble

<scenarios>
  <scenario>
    <mode>in_the_moment</mode>
    <label>[3-5 word title for this conversation]</label>
    <tagline>[one short sentence enticing the reader to pick this]</tagline>
    <anchor_scene>[exact scene title, or empty for non-anchored modes]</anchor_scene>
    <personality>[the second-person persona]</personality>
    <start_script>[the spoken opening line]</start_script>
  </scenario>
  ... one <scenario> per mode, in the order listed ...
</scenarios>`;

export default createPrompt(meta, prompt);
