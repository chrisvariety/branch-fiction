import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  pairs: v.array(
    v.object({
      source: v.object({
        friendlyId: v.string(),
        name: v.string(),
        label: v.optional(v.string())
      }),
      target: v.object({
        friendlyId: v.string(),
        name: v.string(),
        label: v.optional(v.string())
      }),
      appellations: v.array(
        v.object({
          phrase: v.string(),
          type: v.string(),
          chapters: v.string(), // e.g. "14-17" or "14, 16, 18-20"
          totalCount: v.number(),
          contexts: v.array(
            v.object({
              chapterIdx: v.number(),
              text: v.string()
            })
          )
        })
      )
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Appellation Arc',
  input: InputSchema
};

const prompt = `You will be analyzing how characters refer to each other throughout a narrative work. Your task is to identify patterns in how different characters address or refer to one another, and group these patterns into distinct "arcs" or phases based on when they occur and whether the pattern of address changes.

The data has been pre-organized into source→target pairs, with appellations grouped by phrase and showing chapter ranges.

<source_target_pairs>
{% for pair in pairs %}
  <pair>
    <source id="{{pair.source.friendlyId}}">
      <name>{{pair.source.name}}</name>
      {% if pair.source.label %}<label>{{pair.source.label}}</label>{% endif %}

    </source>
    <target id="{{pair.target.friendlyId}}">
      <name>{{pair.target.name}}</name>
      {% if pair.target.label %}<label>{{pair.target.label}}</label>{% endif %}

    </target>
    <appellations>
{% for appellation in pair.appellations %}
      <appellation>
        <phrase>{{appellation.phrase}}</phrase>
        <type>{{appellation.type}}</type>
        <chapters>{{appellation.chapters}}</chapters>
        <total_count>{{appellation.totalCount}}</total_count>
        <contexts>
{% for context in appellation.contexts %}
          <context chapter="{{context.chapterIdx}}">{{context.text}}</context>
{% endfor %}
        </contexts>
      </appellation>
{% endfor %}
    </appellations>
  </pair>
{% endfor %}
</source_target_pairs>

Each pair contains:
- source: The character doing the referring, identified by id, name, and an optional label used for disambiguation
- target: The character being referred to, identified by id, name, and an optional label used for disambiguation
- appellations: A list of phrases used, grouped by phrase, each containing:
  - phrase: The actual name/nickname/term used
  - type: The type of appellation (e.g., GIVEN_NAME, NICKNAME, TITLE)
  - chapters: The chapter range where this phrase appears (e.g., "14-17" or "14, 16, 18-20")
  - total_count: How frequently this phrase appears—use this to identify the dominant form of address versus occasional or one-time usages
  - contexts: Sample descriptions of how and when this appellation was used, with chapter numbers

Your goal is to organize each source→target pair into "arcs". An "arc" represents a phase in the narrative where a character consistently refers to another character in a particular way or set of ways. A new arc begins when there's a meaningful shift in how one character addresses another (e.g., from formal to informal, from hostile to affectionate, or from one nickname to another).

Before producing the output, think through each pair:

1. For each source→target pair, examine the chronological progression of appellations:
   - Which phrase has the highest total_count? This is their primary/default form of address
   - Which phrases appear rarely (count of 1-2)? These may be situational or mark special moments
   - Does the dominant phrase change across chapter ranges?
   - Do the contexts suggest a shift in relationship (e.g., from formal to intimate)?
   - If a character consistently uses the same appellation(s) throughout, that's one arc
   - If the dominant pattern changes meaningfully, split into multiple arcs

2. For each arc, note:
   - The chapter range (start and end)
   - The primary phrase (highest count) and how it's typically used
   - Any secondary phrases, noting their relative rarity and when they appear
   - Contextual patterns (e.g., "uses full name when angry, nickname when friendly")

## Output Format

Return an XML document containing appellation arc snapshots. Only create multiple arcs when the pattern of address genuinely shifts.

\`\`\`xml
<appellation_arcs>
  <arc>
    <source_id>id of source character (from the id attribute of the source element in the input)</source_id>
    <target_id>id of target character (from the id attribute of the target element in the input)</target_id>
    <phase>Evocative 3-5 word title capturing THIS phase of address (e.g., "Formal Distance", "Growing Intimacy", "Bitter Estrangement")</phase>
    <chapters>1-5</chapters>
    <detail>Write a self-contained paragraph describing the appellations used during this phase. Lead with the dominant form of address and its typical usage, then mention any less frequent alternatives and when they appear. A reader encountering only this arc should fully understand how the source addresses the target during these chapters without needing to read any other arc.</detail>
  </arc>
</appellation_arcs>
\`\`\`

The <chapters> element should contain a chapter range in one of these formats:
- Single chapter: "5"
- Range: "5-12"
- Open-ended: "15+"

## Writing the Detail

The detail should analyze WHEN and WHY each phrase is used—the circumstances, situations, and emotional contexts that trigger each form of address. This is the core insight, not merely listing what phrases exist.

For each phrase, explain:
- What situations prompt this form of address (sparring, intimate moments, public settings, danger)
- The emotional register (taunting, affectionate, urgent, formal)
- How the usage pattern reveals relationship dynamics

Use counts to establish dominance, then focus on situational analysis:
- Lead with the dominant phrase and its typical contexts
- For secondary phrases, explain what specific situations trigger them
- Don't include chapter numbers in parentheticals—the arc's chapter range already establishes timing

Each arc should be self-contained. Avoid "continues to use," "still calls them," or "now switches to"—these assume knowledge of other arcs.

Good example: "Elena predominantly uses the familiar 'Marcus' during their training sessions—calling out to him during sparring, seeking his guidance in quiet moments, and shouting his name in moments of crisis. The formal 'Master Thorne' emerges only in guild settings when others are present, a public acknowledgment of his rank that disappears the moment they're alone."

Poor example: "Elena uses 'Marcus' (ch12,16,22) and 'Master Thorne' (ch15,33) in training and formal settings." (Lists phrases with chapters instead of analyzing when/why each is used)

Your final output should be the complete appellation_arcs XML structure, with no additional commentary around it.`;

export default createPrompt(meta, prompt);
