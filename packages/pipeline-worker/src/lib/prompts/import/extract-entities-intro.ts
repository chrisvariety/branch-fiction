import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  focalStartChapter: v.number(),
  endChapter: v.number(),
  maxChapter: v.number(),
  contextChapter: v.optional(v.number()),
  chapterContent: v.string(),
  existingEntities: v.optional(v.string())
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Entities Intro',
  input: InputSchema
};

const prompt = `You are an expert literary analyst tasked with tracking how significant entities are referred to across chapters in a novel. You will work through several focused passes to identify and catalog entities while avoiding duplication.

The chapters you need to analyze for this round have been preloaded below. Focus extraction on chapters {{ focalStartChapter }}–{{ endChapter }}.{% if contextChapter %} Chapter {{ contextChapter }} is also included for narrative continuity but you do not need to extract entities from it unless it reveals new information about entities you would otherwise miss.{% endif %} The book has {{ maxChapter }} chapter(s) total. Use the \`book_chapter_content\` tool only if the last preloaded chapter ends on a cliffhanger or hints at an impending "grand reveal" that would change how earlier entities should be classified.

<preloaded_chapters>
{{ chapterContent }}
</preloaded_chapters>

You have access to the following tools:

- \`add_entity({label, names, description?, pronouns?, has_voice?})\`: Add a new entity you've discovered.
- \`update_entity({entity_id, label?, add_names?, remove_names?, description?, pronouns?, has_voice?})\`: Update an existing entity. Use the entity ID from the existing entities list or one returned by a prior \`add_entity\` call. Use \`add_names\` to append new verbatim phrases to the entity's names list, or \`remove_names\` to strip names that were wrongly assigned to it.
- \`merge_entities({primary_entity_id, secondary_entity_id, label?, add_names?, description?, pronouns?, has_voice?})\`: Merge two entities that turn out to be the same (e.g., after a grand reveal, or when an unnamed entity becomes named). The secondary entity is merged into the primary.
- \`book_chapter_content({chapterIdx})\`: Fetch an additional chapter beyond the preloaded range, only when the cliffhanger/reveal heuristic above applies.

**Shared field guidelines** (focus-specific guidance for \`label\` and \`names\` will be given in each pass):

- **description**: A brief description (1-2 sentences) written in present tense. Describe unique traits, appearance, role, or significance.
- **pronouns** (optional): Use "he/him", "she/her", "they/them", "it/its", or "unknown" if not yet revealed or not applicable.
- **has_voice**: Use \`true\` ONLY if the reader directly experiences this entity's voice or thoughts through spoken dialogue, internal monologue, mental communication, or point-of-view narration. Use \`false\` for entities that are merely mentioned, described by others, or talked about—even if they could theoretically communicate. Being referenced in someone else's dialogue does NOT count as having a voice.

**Names — exclusions that apply to every pass:**
- Pronouns (I, me, my, he, she, they, it, etc.)
- Generic relational terms that only identify from a specific POV (Mom, Dad, sis, brother, etc.)
- Generic descriptors without distinguishing details (e.g., "the man", "the woman", "the guard", "the sword", "the artifact")

{% if existingEntities %}
Here is the list of entities that have already been identified in previous rounds. Check this list carefully before adding any new entity to avoid duplicates. As you call \`add_entity\`, \`update_entity\`, and \`merge_entities\` in this conversation, those changes will be visible in subsequent passes through the tool call history—you do not need to re-check this list for entities you've already added.

<existing_entities>
{{ existingEntities }}
</existing_entities>
{% endif %}

We will work through three focused passes on these chapters: unidentified entities, then identified (named) entities, then world-building elements. The first pass instructions follow.`;

export default createPrompt(meta, prompt);
