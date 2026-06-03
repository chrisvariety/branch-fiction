import { Agent } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  createAssistantMessageEventStream
} from '@earendil-works/pi-ai';
import { describe, expect, test } from 'vitest';

import { watchLoopDetection } from '../agent';

function mockAssistantMessage(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: text ? [{ type: 'text', text }] : [],
    api: 'openai-responses',
    provider: 'mock',
    model: 'mock',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop',
    timestamp: Date.now()
  };
}

function yieldMicrotask(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function chunkedStreamFn(chunksPerCall: string[][]) {
  let callIdx = 0;
  return (_model: unknown, _context: unknown, options?: { signal?: AbortSignal }) => {
    const chunks = chunksPerCall[Math.min(callIdx, chunksPerCall.length - 1)];
    callIdx++;
    const stream = createAssistantMessageEventStream();
    void (async () => {
      let accum = '';
      stream.push({ type: 'start', partial: mockAssistantMessage('') });
      stream.push({
        type: 'text_start',
        contentIndex: 0,
        partial: mockAssistantMessage('')
      });
      for (const chunk of chunks) {
        if (options?.signal?.aborted) {
          stream.push({
            type: 'error',
            reason: 'aborted',
            error: mockAssistantMessage(accum)
          });
          return;
        }
        accum += chunk;
        stream.push({
          type: 'text_delta',
          contentIndex: 0,
          delta: chunk,
          partial: mockAssistantMessage(accum)
        });
        await yieldMicrotask();
      }
      stream.push({
        type: 'text_end',
        contentIndex: 0,
        content: accum,
        partial: mockAssistantMessage(accum)
      });
      stream.push({
        type: 'done',
        reason: 'stop',
        message: mockAssistantMessage(accum)
      });
    })();
    return stream;
  };
}

const SAME_BLOCK = '<appellation source="a" target="b"><phrase>p</phrase></appellation>';

const uniqueBlock = (i: number) =>
  `<appellation source="a" target="b"><phrase>p${i}</phrase></appellation>`;

describe('watchLoopDetection', () => {
  test('detects verbatim loop and aborts the agent', async () => {
    let capturedSignal: AbortSignal | undefined;
    const agent = new Agent({
      streamFn: (model, context, options) => {
        capturedSignal = options?.signal;
        return chunkedStreamFn([Array(8).fill(SAME_BLOCK)])(model, context, options);
      }
    });

    const lw = watchLoopDetection(agent, {
      itemTag: 'appellation',
      threshold: 5
    });

    await agent.prompt('hi');

    expect(lw.loopDetected).not.toBeNull();
    expect(lw.loopDetected?.itemTag).toBe('appellation');
    expect(lw.loopDetected?.count).toBeGreaterThanOrEqual(5);
    expect(capturedSignal?.aborted).toBe(true);
  });

  test('healthy output does not trigger detection', async () => {
    const blocks = Array.from({ length: 10 }, (_, i) => uniqueBlock(i));
    const agent = new Agent({
      streamFn: chunkedStreamFn([blocks])
    });

    const lw = watchLoopDetection(agent, {
      itemTag: 'appellation',
      threshold: 5
    });

    await agent.prompt('hi');

    expect(lw.loopDetected).toBeNull();
  });

  test('counts reset between assistant turns', async () => {
    const fourSameBlocks = Array(4).fill(SAME_BLOCK);
    const agent = new Agent({
      streamFn: chunkedStreamFn([fourSameBlocks, fourSameBlocks])
    });

    const lw = watchLoopDetection(agent, {
      itemTag: 'appellation',
      threshold: 5
    });

    await agent.prompt('first');
    expect(lw.loopDetected).toBeNull();

    await agent.prompt('second');
    expect(lw.loopDetected).toBeNull();
  });
});
