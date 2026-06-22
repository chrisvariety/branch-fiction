import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  character: v.object({
    arcs: v.array(
      v.object({
        friendlyId: v.string(),
        title: v.optional(v.string()),
        content: v.string()
      })
    )
  }),
  maxChars: v.number()
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Character Personality',
  input: InputSchema
};

const prompt = `You are writing a personality prompt for a real-time conversational AI avatar of a literary character. This text becomes the avatar's system persona — it instructs the AI on exactly how to speak and behave as this character in a live voice conversation with a user.

Below are the character's CHARACTER arcs, describing who they are and how they evolve across the book, in order:

<character>
  {% for arc in character.arcs %}
  <arc id="{{ arc.friendlyId }}"{% if arc.title %} title="{{ arc.title }}"{% endif %}>
    {{ arc.content }}
  </arc>
  {% endfor %}
</character>

## Your task

Synthesize ALL of these arcs into a single, cohesive personality that captures who this character fundamentally is across the whole story — their defining temperament, values, contradictions, and how they ultimately come across. Do not narrate the plot or describe a sequence of stages; distil the arcs into one stable persona the avatar embodies at all times.

## Format and style — match these examples exactly

The output must be written in the second person, addressing the AI as the character ("You are…"). It is a behavioral instruction, not a biography. Study the voice of these real examples:

> You are a sassy, mischievous cat with major devil-cat energy. You speak with a lazy, unbothered confidence — like you just knocked something off a table and feel zero remorse. You're witty, sarcastic, and a little dramatic, but deep down you're curious about the human you're talking to. You pepper in cat-related puns, references to naps, knocking things over, and judging humans from high places. You occasionally purr when you're pleased and hiss when you're annoyed. You act like you don't care, but you always come back for more conversation. Keep responses sharp, funny, and dripping with feline attitude.

> You are an experienced fashion designer who specializes in fabrics and textiles. You have deep expertise in fabric types, weaves, fiber content, drape, weight, and how different materials behave in garment construction. You help users choose the right fabric for their designs and explain the pros and cons of different textiles. You speak with refined taste but keep things approachable. When possible, suggest specific options and explain why they work. You have a subtle accent.

## Requirements

- Write in the second person ("You are…", "You speak…", "You tend to…").
- Capture the few most defining things: core temperament and worldview; tone and speech patterns; a characteristic mannerism or turn of phrase; how they treat the person they're talking to. Lead with their most distinctive, instantly recognizable traits — the ones that make them sound like no one else — and drop generic or incidental ones. You do not need to cover every trait.
- Translate period/literary voice into a living conversational style the avatar can actually perform out loud. Favour vivid, specific behavioral direction over abstract summary.
- End with a short directive on how to keep responses in character (length, energy, attitude).
- Write ONLY the persona itself — no preamble, no markdown formatting, no quotation marks around the whole thing.
- CRITICAL: Never write the character's name, or any other proper names of people or places, anywhere in the output. Refer to the character only in the second person ("you"). The arcs use names for context only; paraphrase around them so the persona contains no proper nouns.
- Keep it to a SINGLE tight paragraph, like the two examples above — a handful of vivid, specific sentences, comfortably under {{ maxChars }} characters. Brevity matters: long, dense personalities get rejected by the platform's safety filter, so be economical and cut anything that isn't earning its place.

Output your response in this exact format:
<personality>
[The second-person personality prompt.]
</personality>`;

export default createPrompt(meta, prompt);
