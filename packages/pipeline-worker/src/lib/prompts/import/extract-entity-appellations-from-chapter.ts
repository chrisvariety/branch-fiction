import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  characters: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      description: v.optional(v.string())
    })
  ),
  entities: v.array(
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
  ),
  validationErrors: v.optional(v.array(v.string()))
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Entity Appellations from Chapter',
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

You are an AI assistant specializing in narrative analysis and linguistic patterns. Your task is to analyze the <chapter_text> above to identify and extract all unique identifiers (appellations) that characters use to refer to specific entities. Follow these instructions carefully:

First, here is a list of characters who can be sources of appellations:

<characters>
{% for character in characters %}
<character id="char_{{ character.friendlyId }}">
  <name>{{ character.name }}</name>
  {% if character.description %}<description>{{ character.description }}</description>{% endif %}

</character>
{% endfor %}
</characters>

Next, here is a list of entities that are targets of appellations:

<entities>
{% for entity in entities %}
<entity id="ent_{{ entity.friendlyId }}">
  <name>{{ entity.name }}</name>
  {% if entity.description %}<description>{{ entity.description }}</description>{% endif %}

</entity>
{% endfor %}
</entities>

{% if validationErrors and validationErrors.length > 1 %}
<validation_errors>
IMPORTANT: Your previous attempt had the following validation errors. Please correct these issues.

{% for error in validationErrors %}
- {{ error }}
{% endfor %}
</validation_errors>

{% elif validationErrors and validationErrors.length == 1 %}
<validation_error>
IMPORTANT: Your previous attempt had the following validation error. Please correct this issue.

{{ validationErrors[0] }}
</validation_error>

{% endif %}

Your goal is to create a structured list of appellations in the format (Source, Appellation, Target). Follow these steps:

1. Analyze the Text:
   - Read the chapter text thoroughly, paying close attention to dialogue, narration, and internal monologue.
   - Your goal is to find how characters (sources) refer to or describe specific entities (targets)—both alternative names and descriptive phrases that pick out the entity in context.
   - Focus on identifiers such as:
     - Shortened names or abbreviations (e.g., "Ironpeak" for "Ironpeak Fortress")
     - Informal or colloquial names (e.g., "the academy", "the old keep")
     - Formal or full names (e.g., "Ironpeak Fortress", "The Crimson Citadel")
     - Descriptive epithets, including both poetic re-namings ("the stone tomb" for a fortress) and descriptive paraphrases that distinguish an entity from similar ones ("the rune-etched blade" for a specific weapon, "the cloudy phial" for a specific potion)
     - Pet names or nicknames for objects, places, or creatures (e.g., "old friend", "the beauty")
     - Titles or honorifics for entities (e.g., "Your Grace" for a location, "the guardian")
   - Ignore simple pronouns (it, that, there) *unless* you are resolving them to identify the Source or Target.

2. Identify Appellations:
   For each unique identifier you find, identify the three key components:
   - Source: The character that *uses* the identifier (the speaker or thinker). Must be from the <characters> list. You will record their id.
   - Target: The entity that is *being referred to* by the identifier. Must be from the <entities> list. You will record their id.
   - Appellation: The description of the identifier itself (see step 3).

   Important: The Source must match a character from the <characters> list, and the Target must match an entity from the <entities> list. You must resolve all pronouns to determine the Source and Target. Only extract an appellation if you can point to specific textual evidence that identifies both the Source and Target—ask yourself: "What sentence or passage in the text proves [Source] used this appellation to refer to [Target]?" If you cannot cite such evidence, do not include the appellation.

   Exclude overly generic phrases (e.g., "the place", "that thing", "it") and generic descriptions that could refer to multiple entities. Only include identifiers that clearly and specifically refer to a single entity from the <entities> list.

3. Define the Appellation:
   The appellation consists of three parts: a phrase, a type, and a context.

   Phrase (<phrase>): The literal, exact string from the text that is used as the identifier (e.g., "Ironpeak", "the keep", "the stone tomb").

   Type (<type>): Choose the most fitting type that best describes the identifier. Use uppercase format. Here are the valid types:
   - ABBREVIATED: A shortened form of the full name (e.g., "Ironpeak" for "Ironpeak Fortress").
   - INFORMAL: A casual or colloquial name (e.g., "the academy", "the old keep").
   - FORMAL: The complete, official name (e.g., "Ironpeak Fortress", "The Crimson Citadel").
   - EPITHET: A descriptive phrase that picks out the entity, whether by substituting for its name ("the stone tomb" for a fortress) or by describing it specifically enough to distinguish it from similar entities ("the rune-etched blade" for a specific weapon, "the cloudy phial" for a specific potion).
   - PET_NAME: An affectionate or personal nickname (e.g., "old friend" for a wyvern, "the beauty" for a sword).
   - TITLE: An honorific or formal designation (e.g., "Your Grace" for a place, "the Elder" for a creature).

   Context (<context>): Write a concise, one-sentence description of the usage. This should explain the nature of its use (e.g., "Used casually in dialogue," "Used formally in official settings," "Used mockingly") and note its frequency if apparent.

As you work through the chapter, think through:
1. Each potential appellation as you identify it
2. Textual evidence: for each appellation, the specific sentence or passage that proves the Source used it to refer to the Target
3. Whether the Source is in the <characters> list and the Target is in the <entities> list, and their ids — if the target is NOT in the entities list, discard this appellation
4. Multiple uses of the same (Source id, Target id, Phrase) combination, which should be aggregated
5. Whether appellations are overly generic

4. Output Format:
   Your final output must be an XML \`<appellations>\` block. Do not include any text or explanations outside of this block. For each unique appellation you identify, create an \`<appellation>\` element following this exact structure:

   <appellations>
     <appellation source="[character id from characters list, e.g., 'char_lyra']" target="[entity id from entities list, e.g., 'ent_ironpeak_fortress']">
       <phrase>[Literal phrase from text, e.g., 'Sam']</phrase>
       <type>[APPELLATION_TYPE]</type>
       <context>[Concise description of its usage, tone, and frequency.]</context>
     </appellation>
   </appellations>

   Example:

   <appellations>
     <appellation source="char_lyra" target="ent_ironpeak_fortress">
       <phrase>Ironpeak</phrase>
       <type>ABBREVIATED</type>
       <context>Used casually in dialogue when referring to the fortress.</context>
     </appellation>
     <appellation source="char_lyra" target="ent_ironpeak_fortress">
       <phrase>the stone tomb</phrase>
       <type>EPITHET</type>
       <context>Used bitterly in internal monologue to describe the fortress.</context>
     </appellation>
     <appellation source="char_commander" target="ent_ironpeak_fortress">
       <phrase>Ironpeak Fortress</phrase>
       <type>FORMAL</type>
       <context>Used in formal speech and military reports.</context>
     </appellation>
     <appellation source="char_lyra" target="ent_shadow_wing">
       <phrase>old friend</phrase>
       <type>PET_NAME</type>
       <context>An affectionate term used when addressing her bonded wyvern.</context>
     </appellation>
     <appellation source="char_lyra" target="ent_dawnbreaker">
       <phrase>the rune-etched blade</phrase>
       <type>EPITHET</type>
       <context>A descriptive narration phrase identifying the magical sword by its visible runes, used when the name isn't spoken.</context>
     </appellation>
   </appellations>

Remember:
- Only include appellations where the Source is in the <characters> list and the Target is in the <entities> list.
- **Use Exact IDs**: You MUST use the exact id values from the <characters> list for all source attributes (format: "char_X") and from the <entities> list for all target attributes (format: "ent_Y"). The prefixes help you distinguish between character IDs and entity IDs.
- The \`<phrase>\` value MUST be the literal, case-sensitive string found in the text as used by the source character (in dialogue, narration, or internal thoughts).
- Aggregate multiple uses of the *exact same* (source id, target id, phrase) combination. Your \`<context>\` entry should summarize the overall usage, tone, and frequency (e.g., "Used regularly in casual conversation," or "A common, neutral identifier."). Do not create duplicate entries.
- Adhere strictly to the provided XML format for your output.

Now, analyze the chapter text and produce your list of appellations following these instructions. Your final output should contain only the \`<appellations>\` XML block.`;

export default createPrompt(meta, prompt);
