import {
  getAttribute,
  extractWrappedXml,
  getInnerHtml,
  parse,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { complete } from '@earendil-works/pi-ai';
import { v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import { createBookArcs } from '@/lib/db/models/book-arc/create-book-arc';
import isolateCharacterAppearanceArcPrompt from '@/lib/prompts/post-processing/isolate-character-appearance-arc';
import isolateCharacterArcPrompt from '@/lib/prompts/post-processing/isolate-character-arc';
import isolateEntityAppearanceArcPrompt from '@/lib/prompts/post-processing/isolate-entity-appearance-arc';
import isolatePlaceArcPrompt from '@/lib/prompts/post-processing/isolate-place-arc';
import isolateRelatedRelationshipArcPrompt from '@/lib/prompts/post-processing/isolate-related-relationship-arc';
import isolateRelationshipArcPrompt from '@/lib/prompts/post-processing/isolate-relationship-arc';
import type { WorkflowContext } from '@/workflow/handler';

import { type ArcType, convertArcFriendlyIdPrefixToIsolated } from './arc-types';

const MAX_ATTEMPTS = 3;

type ArcForIsolation = {
  bookId: string;
  friendlyIdPrefix: string;
  friendlyIdIdx: number;
  startChapterId: string;
  endChapterId: string;
  title: string;
  content: string;
  bookEntityIds: string[];
};

type EntityInfo = {
  name: string;
  type: string;
};

export async function isolateArcs(
  {
    arcType,
    arcs,
    entities
  }: {
    arcType: ArcType;
    arcs: ArcForIsolation[];
    bookId: string;
    bookTitle: string;
    entities?: EntityInfo[];
  },
  ctx: WorkflowContext
) {
  if (arcs.length === 0) {
    return [];
  }

  const friendlyIdPrefix = arcs[0].friendlyIdPrefix;
  const mismatch = arcs.find((a) => a.friendlyIdPrefix !== friendlyIdPrefix);
  if (mismatch) {
    throw new UnrecoverableError(
      `All arcs must share the same friendlyIdPrefix. Expected "${friendlyIdPrefix}", got "${mismatch.friendlyIdPrefix}"`
    );
  }

  const isolatedFriendlyIdPrefix = convertArcFriendlyIdPrefixToIsolated(friendlyIdPrefix);

  const isolatedSnapshots =
    arcs.length === 1 ? [] : await runIsolatePrompt({ arcType, arcs, entities }, ctx);

  // Build all isolated arcs: baseline (copied as-is) + isolated snapshots
  const baselineArc = arcs[0];
  const arcsToInsert = [
    {
      id: uuidv7(),
      bookId: baselineArc.bookId,
      type: `${arcType}_ISOLATED`,
      startChapterId: baselineArc.startChapterId,
      endChapterId: baselineArc.endChapterId,
      title: baselineArc.title,
      content: baselineArc.content,
      bookEntityIds: baselineArc.bookEntityIds
    },
    ...isolatedSnapshots.map(({ idx, snapshot }) => {
      const arc = arcs.find((a) => a.friendlyIdIdx === idx);
      if (!arc) {
        throw new RecoverableError(
          `Snapshot idx ${idx} does not match any arc in group ${arcs[0].friendlyIdPrefix}`
        );
      }
      return {
        id: uuidv7(),
        bookId: arc.bookId,
        type: `${arcType}_ISOLATED`,
        startChapterId: arc.startChapterId,
        endChapterId: arc.endChapterId,
        title: arc.title,
        content: snapshot,
        bookEntityIds: arc.bookEntityIds
      };
    })
  ];

  const createdArcs = await createBookArcs(arcsToInsert, isolatedFriendlyIdPrefix);

  ctx.log.info(
    `Created ${createdArcs.length} isolated ${arcType} arcs (prefix: ${isolatedFriendlyIdPrefix})`
  );

  return createdArcs;
}

async function runIsolatePrompt(
  {
    arcType,
    arcs,
    entities
  }: {
    arcType: ArcType;
    arcs: ArcForIsolation[];
    entities?: EntityInfo[];
  },
  ctx: WorkflowContext
): Promise<Array<{ idx: number; snapshot: string }>> {
  let attempt = 0;
  let lastError: string | null = null;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    ctx.log.info(`Isolate prompt attempt ${attempt} of ${MAX_ATTEMPTS} for ${arcType}`);

    try {
      let result = await executePrompt({ arcType, arcs, entities }, ctx);

      const expectedArcs = arcs.slice(1);
      const baselineArc = arcs[0];

      // Check if the result includes the baseline arc
      const baselineInResult = result.find((r) => r.idx === baselineArc.friendlyIdIdx);
      if (baselineInResult) {
        if (baselineInResult.snapshot === baselineArc.content) {
          ctx.log.info(
            `Filtering out unchanged baseline arc (idx ${baselineArc.friendlyIdIdx}) from result`
          );
          result = result.filter((r) => r.idx !== baselineArc.friendlyIdIdx);
        } else {
          lastError = `Result includes modified baseline arc (idx ${baselineArc.friendlyIdIdx})`;
          ctx.log.error(`Validation error in attempt ${attempt}: ${lastError}`);
          continue;
        }
      }

      if (result.length !== expectedArcs.length) {
        lastError = `Expected ${expectedArcs.length} snapshots (excluding baseline) but got ${result.length}`;
        ctx.log.error(`Validation error in attempt ${attempt}: ${lastError}`);
        continue;
      }

      const inputIdxSet = new Set(expectedArcs.map((a) => a.friendlyIdIdx));
      const outputIdxSet = new Set(result.map((r) => r.idx));

      const missingIdxs = [...inputIdxSet].filter((idx) => !outputIdxSet.has(idx));
      if (missingIdxs.length > 0) {
        lastError = `Missing idx values in output: ${missingIdxs.join(', ')}`;
        ctx.log.error(`Validation error in attempt ${attempt}: ${lastError}`);
        continue;
      }

      ctx.log.info(`Successfully generated ${result.length} isolated snapshots`);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      ctx.log.error(`Error in attempt ${attempt}: ${lastError}`);
    }
  }

  throw new RecoverableError(
    `Reached maximum attempts (${MAX_ATTEMPTS}) for ${arcType}: ${lastError}`
  );
}

const SnapshotsOutputSchema = v.object({
  snapshots: v.array(
    v.object({
      idx: v.number(),
      snapshot: v.string()
    })
  )
});

async function executePrompt(
  {
    arcType,
    arcs,
    entities
  }: {
    arcType: ArcType;
    arcs: ArcForIsolation[];
    entities?: EntityInfo[];
  },
  ctx: WorkflowContext
): Promise<Array<{ idx: number; snapshot: string }>> {
  const arcData = arcs.map((arc) => ({
    idx: arc.friendlyIdIdx,
    content: arc.content || ''
  }));

  const isCharacterEntity = entities?.[0]?.type === 'CHARACTER';

  let userText: string;

  switch (arcType) {
    case 'CHARACTER':
      userText = isolateCharacterArcPrompt.render({ character_arcs: arcData });
      break;

    case 'PLACE':
      userText = isolatePlaceArcPrompt.render({ place_arcs: arcData });
      break;

    case 'RELATIONSHIP':
      userText = isolateRelationshipArcPrompt.render({ relationship_arcs: arcData });
      break;

    case 'APPEARANCE':
      userText = isCharacterEntity
        ? isolateCharacterAppearanceArcPrompt.render({ appearance_arcs: arcData })
        : isolateEntityAppearanceArcPrompt.render({ appearance_arcs: arcData });
      break;

    case 'RELATED_RELATIONSHIP': {
      const relatedEntity = entities?.find((e) => e.type !== 'CHARACTER');
      userText = isolateRelatedRelationshipArcPrompt.render({
        entity: {
          name: relatedEntity?.name || 'Unknown',
          type: relatedEntity?.type || 'UNKNOWN'
        },
        entity_arcs: arcData
      });
      break;
    }

    default:
      throw new UnrecoverableError(`Unknown arc type: ${arcType}`);
  }

  const { model, apiKey, reasoning } = ctx.getPiModel('piText');
  const message = await complete(
    model,
    { messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const text = getAssistantText(message);
  const xml = extractWrappedXml(text, 'snapshots');

  if (!xml) {
    ctx.log.warn(`Agent: ${text}`);
    throw new RecoverableError('No snapshots found in response');
  }
  ctx.log.info(`Agent: captured <snapshots> (length: ${xml.length})`);

  const ast = parse(xml);
  const snapshotNodes = querySelectorAll(ast, 'snapshot');

  const validatedData = v.safeParse(SnapshotsOutputSchema, {
    snapshots: snapshotNodes.map((node) => ({
      idx: Number(getAttribute(node, 'idx') || ''),
      snapshot: getInnerHtml(node).trim()
    }))
  });

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse snapshots: ${v.summarize(validatedData.issues)}`
    );
  }

  return validatedData.output.snapshots;
}
