import type { Agent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';

import { extractWrappedXml } from '@/lib/llm/xml';
import type { WorkflowContext } from '@/workflow/handler';

export type AgentToolCall = { name: string; args: Record<string, unknown> };

export function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

type AgentWatcher = {
  xml: string | null;
  toolCalls: AgentToolCall[];
  lastAssistantText: string | null;
  lastAssistantMessage: AssistantMessage | null;
};

export function watchAgent(
  name: string,
  agent: Agent,
  ctx: WorkflowContext,
  wrapperTag?: string
): AgentWatcher {
  const watcher: AgentWatcher = {
    xml: null,
    toolCalls: [],
    lastAssistantText: null,
    lastAssistantMessage: null
  };

  ctx.traceAgent(name, agent);

  agent.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      ctx.trackUsage(event.message);
      const text = getAssistantText(event.message);
      watcher.lastAssistantText = text;
      watcher.lastAssistantMessage = event.message;

      const captured = wrapperTag ? extractWrappedXml(text, wrapperTag) : null;
      if (captured !== null) {
        ctx.log.info(`Agent: captured xml (length: ${text.length})`);
        watcher.xml = captured;
      } else if (text.trim()) {
        ctx.log.info(`Agent: ${text}`);
      }
    } else if (event.type === 'tool_execution_start') {
      ctx.log.info(`Calling tool: ${event.toolName} ${JSON.stringify(event.args)}`);
      watcher.toolCalls.push({
        name: event.toolName,
        args: (event.args ?? {}) as Record<string, unknown>
      });
    }
  });

  return watcher;
}

type LoopDetectionWatcher = {
  loopDetected: { itemTag: string; count: number; sampleBlock: string } | null;
};

export function watchLoopDetection(
  agent: Agent,
  options: { itemTag: string; threshold?: number }
): LoopDetectionWatcher {
  const watcher: LoopDetectionWatcher = { loopDetected: null };
  const threshold = options.threshold ?? 5;
  const itemTag = options.itemTag;
  const openRe = new RegExp(`<${itemTag}[\\s/>]`, 'g');
  const closeStr = `</${itemTag}>`;

  let counts = new Map<string, number>();
  let cursor = 0;
  let openIdx: number | null = null;

  agent.subscribe((event) => {
    if (watcher.loopDetected) return;

    if (event.type === 'message_start' && event.message.role === 'assistant') {
      counts = new Map();
      cursor = 0;
      openIdx = null;
      return;
    }

    if (event.type !== 'message_update') return;
    if (event.message.role !== 'assistant') return;

    const text = getAssistantText(event.message);

    while (cursor < text.length) {
      if (openIdx === null) {
        openRe.lastIndex = cursor;
        const m = openRe.exec(text);
        if (!m) {
          cursor = text.length;
          break;
        }
        openIdx = m.index;
        cursor = m.index + 1;
        continue;
      }
      const closeIdx = text.indexOf(closeStr, cursor);
      if (closeIdx === -1) {
        cursor = text.length;
        break;
      }
      const blockEnd = closeIdx + closeStr.length;
      const normalized = text.slice(openIdx, blockEnd).replace(/\s+/g, ' ').trim();
      const count = (counts.get(normalized) ?? 0) + 1;
      counts.set(normalized, count);
      if (count >= threshold) {
        watcher.loopDetected = {
          itemTag,
          count,
          sampleBlock: normalized.slice(0, 200)
        };
        agent.abort();
        return;
      }
      openIdx = null;
      cursor = blockEnd;
    }
  });

  return watcher;
}
