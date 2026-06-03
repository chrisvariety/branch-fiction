import { randomUUID } from 'node:crypto';

import {
  ARC_STEPS,
  EXTRACT_STEPS,
  PROJECTION_STEPS
} from '../../packages/pipeline-worker/src/pipeline/definition';
import type { Step } from '../../packages/pipeline-worker/src/pipeline/types';
import { expect, test } from '../fixtures';
import { getCapturedInvokes } from '../lib/captured-invokes';

// Sample narration lines per step. Same shape (and roughly the same prose) the
// real workflow handlers emit via `ctx.narrate` - see
// packages/pipeline-worker/src/workflow/**/*.ts.
const NARRATIONS: Record<string, string[]> = {
  imported_book: ['Let\'s get started, cracking into "{TITLE}" now.'],
  preliminary_scenes: ['Reading chapter by chapter, marking where scenes begin and end.'],
  extract_broad_categories: ['Diving in a bit to see how this book is put together.'],
  extract_entities: [
    'Reading through the whole book to extract every person, place, or thing mentioned.',
    'Found 247 entities in total.'
  ],
  categorize_entities: [
    'Sorting 200 entities into categories.',
    'characters, places, organizations, objects.'
  ],
  finalize_scenes: ['Remember all those scenes? Time to tie all that data together.'],
  extract_styles: ["Extracting the 'essence' of each perspective."],
  estimate_significance: ['Counting up appearances to guess what matters most.'],
  extract_appellations: [
    'Simultaneously, reading each chapter to see who calls who what.'
  ],
  summarize_appellations: [
    'Summarizing how characters address each other.',
    'Now doing the same for places and other named things.'
  ],
  extract_relationships: ['Mapping out all the relationships. Who likes who?'],
  extract_entity_attributes: ['Learning all the minute details: hair, eyes, etc.'],
  extract_hierarchy: ['Mapping the hubs, and hidden corners of the world.'],
  determine_minors: ['Also checking character ages and descriptions.'],
  calculate_significance: ['Calculating who matters most in this story.'],
  extract_related_relationship_arc: ['Looking at how the main relationships connect.'],
  extract_relationship_arc: [
    'Now tracing how those relationships evolve chapter by chapter.'
  ],
  extract_appellation_arc: ['Tracking how characters are addressed over time.'],
  extract_entity_appearances_batch: [
    'Simultaneously, figuring out what everything looks like.'
  ],
  character_arc: ['Tracing every character through their journey.'],
  place_arc: ['Walking each setting through its changes.'],
  character_identity_tags: ['Writing a one-line identity tag for each main character.'],
  place_identity_tags: ['Simultaneously, doing the same for key places.']
};

// One narration per major DAG phase we expect the user to actually see while
// the worker walks. Asserted sequentially - the test holds at each anchor
// until the UI has rendered it, which proves the walker progressed that far.
const EXTRACT_ANCHORS = [
  "Let's get started", // imported_book - reading wave 1
  'Found 247 entities in total.', // extract_entities - mid-reading
  "Extracting the 'essence' of each perspective.", // extract_styles - mapping
  'Mapping the hubs, and hidden corners of the world.' // extract_hierarchy - structure
];

const ARC_ANCHORS = [
  'Looking at how the main relationships connect.', // arcs wave 1
  'Now tracing how those relationships evolve chapter by chapter.', // arcs wave 2
  'Writing a one-line identity tag for each main character.' // identifying
];

// How long each line stays alone before the next narration is appended within
// the same step.
const BETWEEN_LINES_MS = 800;
// Minimum total runtime per step. Wider than the UI's 2 s refetch interval so
// every running step is guaranteed to show up in at least one snapshot.
const STEP_DURATION_MS = 2200;

test('walks an EPUB through the pipeline DAG', async ({ page, db }) => {
  test.setTimeout(90_000);

  // Lands on the upload screen because providers are seeded with both slots filled
  await expect(page.getByText('Import a book')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /Choose file/i }).click();

  // After validation completes the action button shows up. We've never run an
  // import with this provider, so there's no prior projection to estimate from
  // and the button offers to run one rather than importing directly.
  const estimate = page.getByRole('button', { name: /Estimate Time & Cost/i });
  await expect(estimate).toBeVisible();
  await estimate.click();

  // The IPC mock for start_book_import is called once the row is in the DB
  await expect
    .poll(() => db.prepare('SELECT COUNT(*) AS n FROM book_imports').get())
    .toMatchObject({ n: 1 });

  const row = db.prepare('SELECT id, title, status FROM book_imports LIMIT 1').get() as {
    id: string;
    title: string;
    status: string;
  };
  expect(row.status).toBe('pending');

  // Count of start_book_import invocations for this import - one per kick-off:
  // initial submit, the Begin Import confirmation, and the post-selection resume.
  const startCount = async () =>
    (await getCapturedInvokes(page)).filter(
      (c) =>
        c.cmd === 'start_book_import' &&
        (c.args as { bookImportId?: string }).bookImportId === row.id
    ).length;

  await expect.poll(startCount).toBe(1);

  // imported_book belongs to both the projection and extract phases, so dedupe
  // by step id - a duplicate pipeline_steps row would split the step's status.
  const allStepIds = [
    ...new Set([...PROJECTION_STEPS, ...EXTRACT_STEPS, ...ARC_STEPS].map((s) => s.id))
  ];

  // Pre-insert every step as 'pending' so chapter status starts and stays
  // accurate; without this a chapter whose remaining rows haven't been
  // inserted yet flickers to 'completed' the moment its earlier rows finish.
  const insertPending = db.prepare(
    `INSERT INTO pipeline_steps (id, book_import_id, step_id, status)
     VALUES (?, ?, ?, 'pending')`
  );
  db.transaction(() => {
    for (const stepId of allStepIds) insertPending.run(randomUUID(), row.id, stepId);
  })();

  const setRunning = db.prepare(
    `UPDATE pipeline_steps SET status = 'running'
     WHERE book_import_id = ? AND step_id = ?`
  );
  const setNarrative = db.prepare(
    `UPDATE pipeline_steps SET narrative = ?
     WHERE book_import_id = ? AND step_id = ?`
  );
  const setCompleted = db.prepare(
    `UPDATE pipeline_steps SET status = 'completed'
     WHERE book_import_id = ? AND step_id = ?`
  );

  // Stand-in for a real handler: mark the step running, append its narration
  // lines one at a time the way `ctx.narrate` does in
  // packages/pipeline-worker/src/workflow/**/*.ts, then mark it completed.
  const runMockStep = async (step: Step) => {
    setRunning.run(row.id, step.id);

    const lines = NARRATIONS[step.id] ?? [];
    const accumulated: Array<{ id: string; text: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      accumulated.push({
        id: `${step.id}-${i}`,
        text: lines[i].replaceAll('{TITLE}', row.title)
      });
      setNarrative.run(JSON.stringify(accumulated), row.id, step.id);
      if (i < lines.length - 1) await page.waitForTimeout(BETWEEN_LINES_MS);
    }

    await page.waitForTimeout(STEP_DURATION_MS);
    setCompleted.run(row.id, step.id);
  };

  // Same shape as packages/pipeline-worker/src/pipeline/runner.ts `runDag`:
  // event-driven, dispatch any step whose deps are completed, advance on each
  // step's completion. Deps outside `steps` (e.g. arc deps on extract steps)
  // count as already satisfied so we can drive each phase independently.
  const walkDag = (steps: Step[], alreadyDone: Iterable<string> = []) =>
    new Promise<void>((resolve) => {
      const ourIds = new Set(steps.map((s) => s.id));
      const completed = new Set<string>(alreadyDone);
      const inFlight = new Set<string>();

      const advance = () => {
        let dispatched = 0;
        for (const step of steps) {
          if (completed.has(step.id) || inFlight.has(step.id)) continue;
          const ready = step.depends.every((d) => !ourIds.has(d) || completed.has(d));
          if (!ready) continue;
          inFlight.add(step.id);
          dispatched++;
          void runMockStep(step).then(() => {
            inFlight.delete(step.id);
            completed.add(step.id);
            advance();
          });
        }
        if (dispatched === 0 && inFlight.size === 0) resolve();
      };

      advance();
    });

  // Projection phase. With no prior run for this provider, the worker first
  // walks a short projection DAG (imported_book + preliminary_scenes_preview)
  // to estimate time and cost. The import page shows this gated behind a
  // Begin Import confirmation rather than rolling straight into the chapters.
  await expect(page.getByText('Sampling scenes')).toBeVisible({ timeout: 30_000 });
  db.prepare(`UPDATE book_imports SET status = 'projection' WHERE id = ?`).run(row.id);
  await walkDag(PROJECTION_STEPS);

  // Projection gate: populate the estimate and flip to awaiting_projection,
  // mirroring the runner's pause after PROJECTION_STEPS finishes.
  db.prepare(
    `UPDATE book_imports
     SET status = 'awaiting_projection',
         eta_min_seconds = 120, eta_max_seconds = 300,
         cost_min_cents = 50, cost_max_cents = 150,
         projection_behavior = 'normal'
     WHERE id = ?`
  ).run(row.id);

  // Confirming the estimate flips status to 'extract' and re-invokes
  // start_book_import to resume into the full import.
  const beginImport = page.getByRole('button', { name: /Begin Import/i });
  await expect(beginImport).toBeVisible({ timeout: 30_000 });
  await beginImport.click();
  await expect.poll(startCount).toBe(2);

  // Drive the extract DAG in the background. The foreground waits on each
  // narration anchor in turn, which both validates the walker progressed and
  // gives the user time to read each chapter's narration before the next one
  // dispatches. The Begin Import confirmation already flipped status to
  // 'extract'; imported_book ran during projection, so it starts done here.
  const walkExtract = walkDag(
    EXTRACT_STEPS,
    PROJECTION_STEPS.map((s) => s.id)
  );
  for (const text of EXTRACT_ANCHORS) {
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 60_000 });
  }
  await walkExtract;

  // Worker reached the selection gate - seed the book + entities and flip
  // status to awaiting in one transaction (mirrors the runner's gate after
  // EXTRACT_STEPS finishes).
  const bookId = randomUUID();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO books (id, share_code, user_id, title, slug)
       VALUES (?, ?, 'default', ?, ?)`
    ).run(bookId, `share-${bookId}`, row.title, `slug-${bookId}`);
    const insertEntity = db.prepare(
      `INSERT INTO book_entities
         (id, friendly_id, book_id, name, type, significance_tier, significance_rank)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    insertEntity.run(
      randomUUID(),
      'C1',
      bookId,
      'Alice Liddell',
      'CHARACTER',
      'PRIMARY',
      1
    );
    insertEntity.run(
      randomUUID(),
      'C2',
      bookId,
      'Cheshire Cat',
      'CHARACTER',
      'SECONDARY',
      2
    );
    insertEntity.run(randomUUID(), 'P1', bookId, 'Wonderland', 'PLACE', 'PRIMARY', 1);
    insertEntity.run(randomUUID(), 'P2', bookId, 'Tea Garden', 'PLACE', 'SECONDARY', 2);
    db.prepare(
      `UPDATE book_imports
       SET book_id = ?, status = 'awaiting_selection'
       WHERE id = ?`
    ).run(bookId, row.id);
  })();

  // Choose your characters chapter. Wait for the previous structure→characters
  // page-turn to settle - otherwise goToChapter('select_places') is a no-op
  // because the click handler bails while `turning` is still set.
  await expect(page.getByText('Alice Liddell')).toBeVisible();
  await expect(page.getByText('Cheshire Cat')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Finding the structure' })).toHaveCount(
    0
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Wait for the page-turn animation to settle before clicking the next Continue.
  await expect(page.getByText('Alice Liddell')).toHaveCount(0);

  // Choose your locations chapter
  await expect(page.getByText('Wonderland')).toBeVisible();
  await expect(page.getByText('Tea Garden')).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // The UI flips status to 'arc' and re-invokes start_book_import to resume.
  await expect.poll(startCount).toBe(3);

  // Drive the arc DAG the same way.
  const walkArc = walkDag(ARC_STEPS);
  for (const text of ARC_ANCHORS) {
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 60_000 });
  }
  await walkArc;

  // Worker finished - flip the import to completed so the UI rolls into the
  // finale chapter.
  db.prepare(`UPDATE book_imports SET status = 'completed' WHERE id = ?`).run(row.id);

  await expect(
    page.getByText(`${row.title} has been imported successfully.`)
  ).toBeVisible();
});
