import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
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
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Character Appellations from Chapter',
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

You are an AI assistant specializing in narrative analysis and character linguistics. Your task is to analyze the <chapter_text> above to identify and extract all unique identifiers (appellations) that characters use to refer to one another. Follow these instructions carefully:

Here is a list of character names to focus on:

<named_entities>
{% for entity in entities %}
<entity id="{{ entity.friendlyId }}">
  <name>{{ entity.name }}</name>
  {% if entity.description %}<description>{{ entity.description }}</description>{% endif %}

</entity>
{% endfor %}
</named_entities>

Your goal is to create a structured list of appellations in the format (Source, Appellation, Target). Analyze the <chapter_text> above and follow these steps:

1. Analyze the Text:
   - Read the chapter text thoroughly, paying close attention to dialogue, narration, and internal monologue.
   - Your goal is to find how one entity refers to another using a specific name or identifier.
   - Focus on identifiers such as:
     - Given names, surnames, and full names, in both narration and direct address (e.g., "Elara", "Blackwood", "Marcus Blackwood")
     - Diminutives (e.g., "Sam" for Samuel)
     - Pet names or nicknames (e.g., "sis", "buddy", "love")
     - Kinship terms used as direct address or specific reference to a character (e.g., "cousin", "brother", "mom", "dad", "auntie")
     - Formal titles used as unique identifiers (e.g., "the Captain", "Professor")
     - Epithets or descriptive names (e.g., "Wise One", "the tall stranger")
     - Any other name-like identifier that singles out a specific character
   - Ignore simple pronouns (he, she, they) *unless* you are resolving them to identify the Source or Target.

2. Identify Appellations:
   For each unique identifier you find, identify the three key components:
   - Source: The character that *uses* the identifier (the speaker or thinker). Must be from the <named_entities> list. You will record their id.
   - Target: The character that is *being referred to* by the identifier. Must be from the <named_entities> list. You will record their id.
   - Appellation: The description of the identifier itself (see step 3).

   Important: The Source and Target must both match entities from the <named_entities> list. You must resolve all pronouns (e.g., "he," "she") to the correct character to determine the Source and Target. The Target must be the actual character being referred to, and that character must be in the <named_entities> list—if an appellation clearly refers to someone not in the list, skip it entirely and do not substitute a related character from the list (e.g., if "Dad" is not listed, do not assign it to a sibling who is). Only extract an appellation if you can point to specific textual evidence that identifies the Target—ask yourself: "What sentence or passage in the text proves this appellation refers to [Target]?" If you cannot cite such evidence, do not include the appellation.

   Exclude overly generic phrases (e.g., "sir", "the man", "the woman", "the place") and generic insults or derogatory terms (e.g., "ass", "bitch", "idiot", "fool") that could refer to multiple characters. Only include identifiers that clearly and specifically refer to a single named character.

3. Define the Appellation:
   The appellation consists of three parts: a phrase, a type, and a context.

   Phrase (<phrase>): The literal, exact string from the text that is used as the identifier (e.g., "Sam", "the Captain", "Wise One").

   Type (<type>): Choose the most fitting type that best describes the identifier. Use uppercase format. Here are the valid types:
   - GIVEN_NAME: The character's standard first name, last name, or full name (e.g., "Elara", "Blackwood", "Marcus Blackwood").
   - DIMINUTIVE: A shortened or familiar form of a proper name (e.g., "Sam" for Samuel, "Liz" for Elizabeth).
   - PET_NAME: An informal, often affectionate, name not based on the proper name (e.g., "sis", "buddy", "darling").
   - KINSHIP: A familial relationship term used to refer to or address a specific character (e.g., "cousin", "brother", "mom", "dad", "auntie").
   - FORMAL_TITLE: A rank, profession, or honorific used as an identifier (e.g., "the Captain", "Professor", "My Lord").
   - EPITHET: A descriptive phrase or adjective-based name (e.g., "the Wise One", "the tall stranger", "Man of Steel").

   Context (<context>): Write a concise, one-sentence description of the usage. This should explain the nature of its use (e.g., "Used affectionately," "Used as a formal address," "Used when angry") and note its frequency if apparent.

As you work through the chapter, think through:
1. Each potential appellation as you identify it
2. Textual evidence: for each appellation, the specific sentence or passage that proves it refers to the Target
3. Whether both Source and Target are in the <named_entities> list, and their ids
4. Whether you're substituting a related entity when the actual target isn't in the list (you shouldn't be)
5. Multiple uses of the same (Source id, Target id, Phrase) combination, which should be aggregated
6. Whether appellations are overly generic or common insults

4. Output Format:
   Your final output must be an XML \`<appellations>\` block. Do not include any text or explanations outside of this block. For each unique appellation you identify, create a \`<appellation>\` element following this exact structure:

   <appellations>
     <appellation source="[character id from named_entities list]" target="[character id from named_entities list]">
       <phrase>[Literal phrase from text, e.g., 'Sam']</phrase>
       <type>[APPELLATION_TYPE]</type>
       <context>[Concise description of its usage, tone, and frequency.]</context>
     </appellation>
   </appellations>

   Example:

   <appellations>
     <appellation source="lena" target="marcus">
       <phrase>Marcus</phrase>
       <type>GIVEN_NAME</type>
       <context>Used as a standard, familiar address during conversation.</context>
     </appellation>
     <appellation source="marcus" target="lena">
       <phrase>Lena</phrase>
       <type>DIMINUTIVE</type>
       <context>An affectionate diminutive used frequently in private, e.g., "Lena, you can't mean it!"</context>
     </appellation>
     <appellation source="kaelen" target="elder">
       <phrase>the old man</phrase>
       <type>EPITHET</type>
       <context>Used in internal monologue to dismissively refer to the Elder.</context>
     </appellation>
     <appellation source="guard" target="kaelen">
       <phrase>Captain</phrase>
       <type>FORMAL_TITLE</type>
       <context>Used as a formal, respectful address of rank.</context>
     </appellation>
   </appellations>

Remember:
- Only include appellations where both the Source and Target are listed in the <named_entities> section.
- **Use Exact IDs**: You MUST use the exact id values from the <named_entities> list for all source and target attributes.
- The \`<phrase>\` value MUST be the literal, case-sensitive string found in the text.
- Aggregate multiple uses of the *exact same* (source id, target id, phrase) combination. Your \`<context>\` entry should summarize the overall usage, tone, and frequency (e.g., "Used regularly, always affectionately," or "A common, neutral identifier."). Do not create duplicate entries.
- Adhere strictly to the provided XML format for your output.

Now, analyze the chapter text and produce your list of appellations following these instructions. Your final output should contain only the \`<appellations>\` XML block.`;

export default createPrompt(meta, prompt);
