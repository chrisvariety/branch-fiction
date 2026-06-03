import '@/lib/env-soft';
import { findEnvKeys, getModel } from '@earendil-works/pi-ai';
import type { Kysely } from 'kysely';
import { v7 as uuidv7 } from 'uuid';

import { DEFAULT_ORG_ID } from '@/app/lib/auth';
import type {
  Database as DB,
  NewPipelineStep,
  NewProvider,
  NewProviderModel
} from '@/app/lib/db/types';
import { createKyselyDb, getDb, initDb } from '@/lib/db';
import { createPipelineSteps } from '@/lib/db/models/pipeline-step/create-pipeline-step';
import { updatePipelineStepById } from '@/lib/db/models/pipeline-step/update-pipeline-step';
import { resolvePiProvider } from '@/lib/llm/models';
import { startLocalBridge } from '@/scripts/lib/local-bridge';
import { handler as categorizeEntities } from '@/workflow/process-book-import/categorize-entities';
import { handler as extractEntities } from '@/workflow/process-book-import/extract-entities';
import { handler as removeAmbiguousEntityNames } from '@/workflow/process-book-import/remove-ambiguous-entity-names';

// Edit before running. MAIN_DB_PATH is the app's main DB (providers, books,
// book_imports live here). IMPORT_DB_PATH is the per-import worker DB.
const MAIN_DB_PATH = './branch-fiction-test.db';
const IMPORT_DB_PATH = './grok-baseline.db';
const BOOK_IMPORT_ID = '019e6af2-e2a0-71bc-9681-30424a21d629';

const PROVIDER_TYPE = 'xai';
const MODEL_KEY = 'grok-4.3';

type HandlerFn = (args: {
  executionId: string;
  payload: Record<string, unknown>;
}) => Promise<unknown>;

const STEPS: { id: string; handler: HandlerFn }[] = [
  { id: 'extract_entities', handler: extractEntities as HandlerFn },
  { id: 'categorize_entities', handler: categorizeEntities as HandlerFn },
  {
    id: 'remove_ambiguous_entity_names',
    handler: removeAmbiguousEntityNames as HandlerFn
  }
];

async function resetProvider(mainDb: Kysely<DB>) {
  const piProvider = resolvePiProvider(PROVIDER_TYPE);
  if (!piProvider) {
    throw new Error(`Unknown provider type "${PROVIDER_TYPE}" — not a pi provider`);
  }

  const model = getModel(piProvider, MODEL_KEY as never);
  const secretEnvVar = findEnvKeys(piProvider)?.[0];
  if (!secretEnvVar) {
    throw new Error(`No known env var for pi provider "${piProvider}"`);
  }
  if (!Deno.env.get(secretEnvVar)) {
    throw new Error(`Set ${secretEnvVar}=… in your environment`);
  }

  await mainDb
    .deleteFrom('providerModels')
    .where('providerId', 'in', (qb) =>
      qb.selectFrom('providers').select('id').where('organizationId', '=', DEFAULT_ORG_ID)
    )
    .execute();
  await mainDb
    .deleteFrom('providers')
    .where('organizationId', '=', DEFAULT_ORG_ID)
    .execute();

  const providerId = uuidv7();
  const provider: NewProvider = {
    id: providerId,
    organizationId: DEFAULT_ORG_ID,
    name: piProvider,
    type: PROVIDER_TYPE,
    baseUrl: model.baseUrl,
    authShape: { kind: 'bearer' },
    username: null,
    secret: null,
    secretLast4: null,
    secretEnvVar,
    secretPriority: 'env',
    config: null
  };
  await mainDb.insertInto('providers').values(provider).execute();

  const providerModelId = uuidv7();
  const providerModel: NewProviderModel = {
    id: providerModelId,
    providerId,
    modelKey: MODEL_KEY,
    displayName: null,
    config: null,
    reasoning: null
  };
  await mainDb.insertInto('providerModels').values(providerModel).execute();

  // Bind the seeded model to this import's text roles (the pipeline reads these
  // columns, mirroring the app).
  await mainDb
    .updateTable('bookImports')
    .set({
      textProviderModelId: providerModelId,
      textLightProviderModelId: providerModelId
    })
    .where('id', '=', BOOK_IMPORT_ID)
    .execute();
}

async function resetSteps() {
  await getDb()
    .deleteFrom('pipelineSteps')
    .where('bookImportId', '=', BOOK_IMPORT_ID)
    .execute();

  const rows: NewPipelineStep[] = STEPS.map((s) => ({
    id: uuidv7(),
    bookImportId: BOOK_IMPORT_ID,
    stepId: s.id,
    fanOutKey: null,
    status: 'pending' as const,
    lastError: null,
    startedAt: null,
    completedAt: null
  }));
  return createPipelineSteps(rows);
}

async function main() {
  if (!MAIN_DB_PATH) throw new Error('Set MAIN_DB_PATH at the top of this file');
  if (!IMPORT_DB_PATH) throw new Error('Set IMPORT_DB_PATH at the top of this file');
  if (!BOOK_IMPORT_ID) throw new Error('Set BOOK_IMPORT_ID at the top of this file');

  initDb(IMPORT_DB_PATH);

  const mainDb = createKyselyDb(MAIN_DB_PATH);
  await resetProvider(mainDb);
  await mainDb.destroy();

  const created = await resetSteps();
  const idByStepId = new Map(created.map((r) => [r.stepId, r.id]));

  const bridge = await startLocalBridge({
    mainDbPath: MAIN_DB_PATH,
    bookImportId: BOOK_IMPORT_ID
  });

  try {
    for (const step of STEPS) {
      const executionId = idByStepId.get(step.id);
      if (!executionId) throw new Error(`No row for ${step.id}`);

      console.log(`> ${step.id}`);
      await updatePipelineStepById(executionId, {
        status: 'running',
        startedAt: new Date().toISOString()
      });
      try {
        await step.handler({ executionId, payload: { bookImportId: BOOK_IMPORT_ID } });
        await updatePipelineStepById(executionId, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          lastError: null
        });
        console.log(`✓ ${step.id}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await updatePipelineStepById(executionId, {
          status: 'failed',
          lastError: message
        });
        console.error(`✗ ${step.id}: ${message}`);
        throw e;
      }
    }
  } finally {
    await bridge.shutdown();
  }
}

await main();
