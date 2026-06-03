import '@/lib/env-soft';
import { handlers } from '@/handlers';
import { getDb, initDb } from '@/lib/db';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { updatePipelineStepById } from '@/lib/db/models/pipeline-step/update-pipeline-step';
import { getStep } from '@/pipeline/definition';
import { startLocalBridge } from '@/scripts/lib/local-bridge';

// Edit before running
const MAIN_DB_PATH =
  '/Users/chrismcc/Library/Application Support/com.lexikon.branchfiction/branch-fiction.db';
const IMPORT_DB_PATH = '/Users/chrismcc/workspace/branch-fiction/grok-test.db';
const PIPELINE_STEP_IDS: string[] = ['019d9788-ad7c-7422-b9bb-0f3eca3bca96'];

async function main() {
  if (!MAIN_DB_PATH) throw new Error('Set MAIN_DB_PATH at the top of this file');
  if (!IMPORT_DB_PATH) throw new Error('Set IMPORT_DB_PATH at the top of this file');
  if (PIPELINE_STEP_IDS.length === 0) {
    throw new Error('Set PIPELINE_STEP_IDS at the top of this file');
  }

  initDb(IMPORT_DB_PATH);
  const db = getDb();

  const firstRow = await db
    .selectFrom('pipelineSteps')
    .select('bookImportId')
    .where('id', '=', PIPELINE_STEP_IDS[0])
    .executeTakeFirst();
  if (!firstRow) {
    throw new Error(`No pipeline_steps row for id ${PIPELINE_STEP_IDS[0]}`);
  }
  const bridge = await startLocalBridge({
    mainDbPath: MAIN_DB_PATH,
    bookImportId: firstRow.bookImportId
  });

  try {
    for (const pipelineStepId of PIPELINE_STEP_IDS) {
      const row = await db
        .selectFrom('pipelineSteps')
        .selectAll()
        .where('id', '=', pipelineStepId)
        .executeTakeFirst();

      if (!row) throw new Error(`No pipeline_steps row for id ${pipelineStepId}`);
      if (row.fanOutKey) {
        throw new Error(
          `Pipeline step ${pipelineStepId} is a fan-out child (key="${row.fanOutKey}"); not supported`
        );
      }

      const stepDef = getStep(row.stepId);
      if (stepDef.kind === 'fan-out') {
        throw new Error(
          `Pipeline step "${row.stepId}" is a fan-out step; not supported by this script`
        );
      }

      const bookImport = await getBookImportById(row.bookImportId);
      const payload = stepDef.payload({
        bookImportId: row.bookImportId,
        bookId: bookImport?.bookId ?? null
      });

      const handler = handlers[row.stepId];
      if (!handler) throw new Error(`Unknown step: ${row.stepId}`);

      console.log(`> ${row.stepId} (${pipelineStepId})`);
      await updatePipelineStepById(pipelineStepId, {
        status: 'running',
        startedAt: new Date().toISOString()
      });

      try {
        await handler({ executionId: pipelineStepId, payload });
        await updatePipelineStepById(pipelineStepId, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          lastError: null
        });
        console.log(`✓ ${row.stepId}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await updatePipelineStepById(pipelineStepId, {
          status: 'failed',
          lastError: message
        });
        console.error(`✗ ${row.stepId}: ${message}`);
        throw e;
      }
    }
  } finally {
    await bridge.shutdown();
  }
}

await main();
