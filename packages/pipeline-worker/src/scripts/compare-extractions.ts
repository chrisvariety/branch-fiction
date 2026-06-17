import '@branch-fiction/extension-sdk/worker/env-soft';
import { Agent } from '@earendil-works/pi-agent-core';
import { getModel } from '@earendil-works/pi-ai';
import { encode } from '@toon-format/toon';
import { v7 as uuidv7 } from 'uuid';

import { initDb } from '@/lib/db';
import { getBookEntitiesByBookId } from '@/lib/db/models/book-entity/get-book-entity';

const BOOK_ID = '019e6af3-0b22-745f-aca2-8b84aab3c156';
const MODEL_ID = 'gemini-3.1-pro-preview';

async function getEntities(dbPath: string) {
  console.log(`Loading entities from ${dbPath}...`);
  initDb(dbPath);
  const entities = await getBookEntitiesByBookId(BOOK_ID);
  console.log(`Found ${entities.length} entities.`);

  return entities.map((e, idx) => {
    const out: Record<string, string | boolean | undefined | string[]> = {
      id: `ent_${idx + 1}`,
      label: e.label || e.name,
      mentions: e.names,
      description: e.description || undefined,
      pronouns: e.pronouns || 'unknown',
      has_voice: e.hasVoice,
      type: e.type
    };
    return Object.fromEntries(Object.entries(out).filter(([_, v]) => v !== undefined));
  });
}

const [dbPath1, dbPath2, requestedModel] = Deno.args;
if (!dbPath1 || !dbPath2) {
  console.error(
    'Usage: deno run -A src/scripts/compare-extractions.ts <db1> <db2> [modelId]'
  );
  Deno.exit(1);
}

const modelId = requestedModel || MODEL_ID;

const entities1 = await getEntities(dbPath1);
const entities2 = await getEntities(dbPath2);

const encoded1 = encode({ entities: entities1 });
const encoded2 = encode({ entities: entities2 });

const apiKey = Deno.env.get('GOOGLE_API_KEY');
if (!apiKey) {
  console.error('GOOGLE_API_KEY not found in environment');
  Deno.exit(1);
}

const model = getModel('google', modelId as never);

const prompt = `You are an expert literary analyst and data engineer. Compare two lists of entities extracted from the same book (Book ID: ${BOOK_ID}).

Your goal is to determine which list is "best" based on how these entities will be used downstream.

### Downstream Usage & Criteria:

1. **Mention Gathering (Crucial)**:
   - We use the "mentions" list to search for verbatim phrases in the text to identify when an entity is being talked about.
   - Good "mentions" include proper names, nicknames, titles, and distinctive descriptive phrases/epithets that uniquely identify the entity (e.g., "the blond guy ahead of us" or "standing opposite Brody's position").
   - **CRITICAL FAILURE**: Duplicate entities. If two entities represent the same person but have overlapping or separate mention sets, it breaks the mention gathering process because we don't know which entity to attribute the occurrence to.
   - **CRITICAL FAILURE**: Overlapping mentions across DIFFERENT entities without distinguishing phrases.
   - **QUALITY NOTE**: We WANT to capture phrases that allow us to identify an entity in contexts where they aren't mentioned by their formal name. Descriptive phrases are POSITIVE as long as they are accurate and unique.

2. **Character Litmus Test**:
   - "has_voice" must be true ONLY if the reader directly experiences the entity's voice or thoughts (dialogue, internal monologue, mental communication).
   - Entities like historical figures mentioned but never speaking should NOT have a voice.
   - Distinguishing "Character" (has agency, speaks) from "Mentioned Individual" (no agency, referenced only) is vital.

3. **Coverage vs. Accuracy**:
   - Missing minor characters is a minor issue.
   - Missing major characters is a significant failure.
   - Merging two different people into one is a major failure.
   - Splitting one person into two (duplicates) is a major failure.

4. **Information for Later Phases**:
   - Descriptions should capture unique traits, appearance, or role to help with later "appearance extraction" and "significance calculation".

### Entity Lists:

<list_1 source="${dbPath1}">
${encoded1}
</list_1>

<list_2 source="${dbPath2}">
${encoded2}
</list_2>

### Task:

Analyze both lists and determine which one is superior. Provide a detailed reasoning focusing on:
- Presence of duplicates or overlapping mentions.
- Accuracy of the 'has_voice' flag.
- Quality and utility of the 'mentions' list for identifying the entity in context.
- Completeness of important characters.

Conclude with:
**BEST_LIST: [1 or 2]**`;

console.log(`Comparing extractions using ${modelId}...`);
console.log('---');

const agent = new Agent({
  sessionId: uuidv7(),
  initialState: {
    model,
    thinkingLevel: 'high'
  },
  getApiKey: () => apiKey
});

let fullResponse = '';
agent.subscribe((event) => {
  if (event.type === 'message_end' && event.message.role === 'assistant') {
    const text = event.message.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
    console.log(text);
    fullResponse += text;
  }
});

try {
  await agent.prompt(prompt);

  console.log('\n--- Result ---');
  const winnerMatch = fullResponse.match(/BEST_LIST:\s*([12])/);
  if (winnerMatch) {
    const winnerIdx = parseInt(winnerMatch[1]);
    const winnerPath = winnerIdx === 1 ? dbPath1 : dbPath2;
    console.log(`🏆 WINNER: ${winnerPath} (List ${winnerIdx})`);
  } else {
    console.log('⚠️ Could not determine the winner from the assistant response.');
  }
} catch (e) {
  console.error('Error during agent prompt:', e);
}
