import './lib/env-soft';
import PQueue from 'p-queue';

import { configureBridge } from './lib/bridge';
import { initDb } from './lib/db';
import { getBookImportById } from './lib/db/models/book-import/get-book-import';
import { getPipelineStepsByBookImportIdAndStepId } from './lib/db/models/pipeline-step/get-pipeline-step';
import { flushLangsmith } from './lib/llm/tracing';
import { finalizeBookImportStatus, runImport } from './pipeline/runner';
import { serveRPC } from './rpc-worker';
import { handler as determineMinors } from './workflow/post-process-book/determine-minors';

const STEP_CONCURRENCY = 10;

const queue = new PQueue({ concurrency: STEP_CONCURRENCY });

let initialized = false;

const api = {
  async init({
    dbPath,
    bridgePort,
    bridgeToken
  }: {
    dbPath: string;
    bridgePort: number;
    bridgeToken: string;
  }) {
    if (initialized) return { ok: true } as const;
    configureBridge(bridgePort, bridgeToken);
    initDb(dbPath);
    initialized = true;
    console.error(
      `[pipeline-worker] initialized dbPath=${dbPath} bridgePort=${bridgePort}`
    );
    return { ok: true } as const;
  },

  async runImport({
    bookImportId,
    retryFailed
  }: {
    bookImportId: string;
    retryFailed?: boolean;
  }) {
    if (!initialized) throw new Error('runImport called before init');

    await runImport(bookImportId, retryFailed ?? false, { queue });
    await finalizeBookImportStatus(bookImportId);

    const bookImport = await getBookImportById(bookImportId);
    const status = (bookImport?.status ?? 'pending') as
      | 'pending'
      | 'projection'
      | 'awaiting_projection'
      | 'extract'
      | 'awaiting_selection'
      | 'arc'
      | 'completed'
      | 'failed';
    return { ok: true, status } as const;
  },

  async recheckMinor({
    bookImportId,
    bookId,
    focusBookEntityId
  }: {
    bookImportId: string;
    bookId: string;
    focusBookEntityId: string;
  }) {
    if (!initialized) throw new Error('recheckMinor called before init');

    const rows = await getPipelineStepsByBookImportIdAndStepId(
      bookImportId,
      'determine_minors'
    );
    const row = rows.find((r) => !r.fanOutKey);
    if (!row) throw new Error('determine_minors step not found');

    try {
      await determineMinors({
        executionId: row.id,
        payload: { bookId, focusBookEntityId }
      });
    } finally {
      await flushLangsmith();
    }

    return { ok: true } as const;
  }
};

await serveRPC(api as unknown as Record<string, (...args: unknown[]) => unknown>);
