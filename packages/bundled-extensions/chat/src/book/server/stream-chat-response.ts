import { type Message, streamSimple } from '@earendil-works/pi-ai';
import { v7 as uuidv7 } from 'uuid';

import { DEFAULT_USER_ID } from '@/lib/auth';
import { detectOutOfSceneMentions } from '@/lib/chat/detect-out-of-scene-mentions';
import {
  resolveEntitiesByFriendlyIds,
  stripFriendlyIdPrefixes
} from '@/lib/chat/friendly-id-map';
import { smoothStream, type StreamMessage } from '@/lib/chat/smooth-stream';
import { getText, parse, querySelector, querySelectorAll } from '@/lib/llm/xml';
import { ensureDbReady, getDb } from '@/worker/db';
import { getEntitiesWithAppearanceArcByBookIds } from '@/worker/db/models/book-arc/get-book-arc';
import { getBookEntitiesByBookIdsAndFriendlyIds } from '@/worker/db/models/book-entity/get-book-entity';
import { createChatNodeParts } from '@/worker/db/models/chat-node-part/create-chat-node-part';
import { deleteChatNodePartsByIds } from '@/worker/db/models/chat-node-part/delete-chat-node-part';
import { createChatNode } from '@/worker/db/models/chat-node/create-chat-node';
import {
  getChatNodeWithPartsById,
  getNodeCountByChatId,
  getRecentActionCountByUserId
} from '@/worker/db/models/chat-node/get-chat-node';
import {
  getChatByUserIdAndSlug,
  getChatHistoryFromCurrentLeafNodeByUserIdAndSlug,
  getNodeAncestryContextByNodeId
} from '@/worker/db/models/chat/get-chat';
import { updateChatById } from '@/worker/db/models/chat/update-chat';
import { getPiModel } from '@/worker/providers';

import { directChat } from './chat-director';

export const DEMO_NODE_LIMIT = 10;
export const OCCASIONAL_IMAGE_GENERATION_REMINDER_INTERVAL = 3;

// Set to true to log the raw, unparsed LLM output for each turn.
const DEBUG_LOG_RAW_OUTPUT = false;

const NARRATIVE_OPEN = '<narrative>';
const NARRATIVE_CLOSE = '</narrative>';
const VISUAL_OPEN = '<visual>';
const VISUAL_CLOSE = '</visual>';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function loadChatNode(params: {
  chatSlug: string;
  nodeId: string;
}): Promise<NonNullable<Awaited<ReturnType<typeof getChatNodeWithPartsById>>>> {
  await ensureDbReady();
  const chat = await getChatByUserIdAndSlug(DEFAULT_USER_ID, params.chatSlug);
  if (!chat) throw new Error('Chat not found');
  const node = await getChatNodeWithPartsById(params.nodeId);
  if (!node || node.chatId !== chat.id) throw new Error('Node not found');
  return node;
}

export async function performChatAction(params: {
  action: string;
  chatSlug: string;
  parentNodeId: string;
}): Promise<{
  node: {
    id: string;
    depth: number;
    childrenCount: number;
    shouldGenerateVisual: boolean;
  };
}> {
  await ensureDbReady();

  const recentActions = await getRecentActionCountByUserId(DEFAULT_USER_ID);
  if (recentActions >= 10) throw new Error('Rate limit exceeded. Please wait a moment.');

  const chat = await getChatByUserIdAndSlug(DEFAULT_USER_ID, params.chatSlug);
  if (!chat) throw new Error('Chat not found');

  if (chat.accessType === 'demo') {
    const nodeCount = await getNodeCountByChatId(chat.id);
    if (nodeCount >= DEMO_NODE_LIMIT) throw new Error('Demo chat limit reached.');
  }

  const parentNode = await getChatNodeWithPartsById(params.parentNodeId);
  if (!parentNode || parentNode.chatId !== chat.id)
    throw new Error('Parent node not found');

  const { alreadyMentionedEntityIds, nodesSinceLastVisual } =
    await getNodeAncestryContextByNodeId(params.parentNodeId);

  const shouldGenerateVisual =
    chat.imageMode === 'occasional'
      ? nodesSinceLastVisual >= OCCASIONAL_IMAGE_GENERATION_REMINDER_INTERVAL
      : true;

  const node = await getDb()
    .transaction()
    .execute(async (trx) => {
      const newNode = await createChatNode(
        {
          id: uuidv7(),
          chatId: chat.id,
          parentNodeId: parentNode.id,
          actionLabel: params.action,
          actionType: parentNode.parts.some(
            (part) => part.type === 'ACTION' && part.content === params.action
          )
            ? 'choice'
            : 'custom_input',
          shouldGenerateVisual
        },
        trx
      );

      await updateChatById(chat.id, { currentLeafNodeId: newNode.id }, trx);

      return newNode;
    });

  const entitiesWithAppearance = chat.bookIds?.length
    ? await getEntitiesWithAppearanceArcByBookIds(chat.bookIds)
    : [];
  const mentionResult = entitiesWithAppearance.length
    ? detectOutOfSceneMentions(
        params.action,
        entitiesWithAppearance,
        alreadyMentionedEntityIds
      )
    : null;
  if (mentionResult) {
    console.log('Out of scene mention:', mentionResult.message);
    await createChatNodeParts([
      {
        id: uuidv7(),
        chatNodeId: node.id,
        type: 'INTERNAL_CONTENT',
        idx: -1,
        content: mentionResult.message,
        subtype: 'entity_mention',
        bookEntityIds: mentionResult.bookEntityIds
      }
    ]);
  }

  return {
    node: {
      id: node.id,
      depth: node.depth,
      childrenCount: node.childrenCount,
      shouldGenerateVisual
    }
  };
}

export async function streamChatResponse(params: {
  nodeId: string;
  chatSlug: string;
}): Promise<null> {
  await ensureDbReady();

  const chat = await getChatByUserIdAndSlug(DEFAULT_USER_ID, params.chatSlug);
  if (!chat) throw new Error('Chat not found');
  if (!chat.systemPrompt) throw new Error('Chat has no system prompt');

  const historyRows = await getChatHistoryFromCurrentLeafNodeByUserIdAndSlug(
    DEFAULT_USER_ID,
    params.chatSlug
  );

  type HistoryRow = (typeof historyRows)[number];
  type HistoryPart = HistoryRow & { partId: string; idx: number };
  const nodeMap = new Map<
    string,
    {
      nodeId: string;
      actionLabel: string;
      actionType: string;
      systemInstruction: string | null;
      shouldGenerateVisual: boolean;
      step: number;
      parts: HistoryPart[];
    }
  >();
  for (const row of historyRows) {
    if (!nodeMap.has(row.nodeId)) {
      nodeMap.set(row.nodeId, {
        nodeId: row.nodeId,
        actionLabel: row.actionLabel,
        actionType: row.actionType,
        systemInstruction: row.systemInstruction,
        shouldGenerateVisual: row.shouldGenerateVisual,
        step: row.step,
        parts: []
      });
    }
    if (row.partId) {
      nodeMap.get(row.nodeId)!.parts.push(row as HistoryPart);
    }
  }
  const nodes = Array.from(nodeMap.values()).sort((a, b) => b.step - a.step);
  const currentNode = nodes.find((n) => n.nodeId === params.nodeId);
  if (!currentNode) throw new Error('Node not found in history');
  if (currentNode.parts.some((part) => part.type !== 'INTERNAL_CONTENT'))
    throw new Error('Node already has parts');
  const previousNodes = nodes.filter((n) => n.nodeId !== params.nodeId);

  function reconstructAssistantXml(node: (typeof previousNodes)[number]): string {
    const sections: string[] = [];

    const visualPart = node.parts.find(
      (p) => p.type === 'VISUAL' && p.subtype !== 'none' && p.subtype !== 'skipped_image'
    );
    if (visualPart?.content) {
      let charsAttr = '';
      const args = visualPart.toolCall?.args;
      if (args && typeof args === 'object' && 'character_ids' in args) {
        const ids = (args as { character_ids?: unknown }).character_ids;
        if (Array.isArray(ids)) charsAttr = ids.join(',');
      }
      sections.push(
        `<visual>\n  <prompt>${escapeXml(visualPart.content)}</prompt>\n  <characters>${charsAttr}</characters>\n</visual>`
      );
    }

    const narrative = node.parts
      .filter((p) => p.type === 'CONTENT')
      .map((p) => p.content)
      .join('\n')
      .trim();
    if (narrative) {
      sections.push(`<narrative>\n${narrative}\n</narrative>`);
    }

    const actions = node.parts
      .filter((p) => p.type === 'ACTION')
      .sort((a, b) => a.idx - b.idx)
      .map((p) => p.content?.trim())
      .filter((s): s is string => Boolean(s));
    if (actions.length > 0) {
      sections.push(
        `<actions>\n${actions.map((a) => `  <action>${escapeXml(a)}</action>`).join('\n')}\n</actions>`
      );
    }

    return sections.join('\n\n');
  }

  const piMessages: Message[] = [];

  for (const node of previousNodes) {
    if (node.systemInstruction) {
      piMessages.push({
        role: 'user',
        content: `[Internal Event]: ${node.systemInstruction}`,
        timestamp: 0
      });
    }

    if (node.actionLabel && node.actionType !== 'system_init') {
      piMessages.push({ role: 'user', content: node.actionLabel, timestamp: 0 });
    }

    for (const part of node.parts) {
      if (part.type === 'INTERNAL_CONTENT') {
        piMessages.push({
          role: 'user',
          content: `[Internal Event]: ${part.content}`,
          timestamp: 0
        });
      }
    }

    const assistantXml = reconstructAssistantXml(node);
    if (assistantXml) {
      piMessages.push({
        role: 'assistant',
        content: [{ type: 'text', text: assistantXml }],
        api: 'google-generative-ai',
        provider: 'google',
        model: 'gemini-flash-latest',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'stop',
        timestamp: 0
      });
    }
  }

  if (currentNode.actionLabel && currentNode.actionType !== 'system_init') {
    piMessages.push({ role: 'user', content: currentNode.actionLabel, timestamp: 0 });
  }
  for (const part of currentNode.parts) {
    if (part.type === 'INTERNAL_CONTENT' && part.content) {
      piMessages.push({
        role: 'user',
        content: `[Internal Event]: ${part.content}`,
        timestamp: 0
      });
    }
  }

  let previousVisual: {
    content: string | null;
    contentUrl: string | null;
    bookEntityIds: string[] | null;
  } | null = null;
  for (let i = previousNodes.length - 1; i >= 0; i--) {
    const visualPart = previousNodes[i].parts.find((part) => part.type === 'VISUAL');
    if (visualPart) {
      previousVisual = {
        content: visualPart.content,
        contentUrl: visualPart.contentUrl,
        bookEntityIds: visualPart.bookEntityIds
      };
      break;
    }
  }

  let buffer = '';
  let visualProcessed = false;
  let narrativeState = 'before' as 'before' | 'inside' | 'done';
  let narrativeEmittedIdx = 0;
  let narrativeContent = '';
  let turnComplete = false;
  const contentPartId = uuidv7();
  const eagerlyWrittenPartIds: string[] = [];

  const streamRefs: {
    controller: ReadableStreamDefaultController<StreamMessage> | null;
  } = { controller: null };
  const readableStream = new ReadableStream<StreamMessage>({
    start(controller) {
      streamRefs.controller = controller;
    }
  });

  const enqueue = (message: StreamMessage) => {
    streamRefs.controller?.enqueue(message);
  };

  const processVisualBlock = async (blockXml: string): Promise<void> => {
    if (visualProcessed) return;

    const doc = parse(blockXml);
    const promptText = getText(querySelector(doc, 'prompt')).trim();
    const charsText = getText(querySelector(doc, 'characters')).trim();
    const friendlyIds = charsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!promptText || !friendlyIds.length || !chat.bookIds?.length) {
      return;
    }

    visualProcessed = true;

    const bookEntities = await getBookEntitiesByBookIdsAndFriendlyIds(
      chat.bookIds,
      stripFriendlyIdPrefixes(friendlyIds)
    );
    const bookEntityIds = resolveEntitiesByFriendlyIds(bookEntities, friendlyIds).map(
      (e) => e.id
    );

    const shouldGenerate = currentNode.shouldGenerateVisual;
    const [visualPart] = await createChatNodeParts([
      {
        id: uuidv7(),
        chatNodeId: params.nodeId,
        type: 'VISUAL',
        idx: 1,
        content: promptText,
        contentUrl: shouldGenerate ? null : (previousVisual?.contentUrl ?? null),
        subtype: shouldGenerate ? 'image' : 'skipped_image',
        bookEntityIds: shouldGenerate
          ? bookEntityIds
          : (previousVisual?.bookEntityIds ?? [])
      }
    ]);
    eagerlyWrittenPartIds.push(visualPart.id);

    if (shouldGenerate) {
      enqueue({
        id: visualPart.id,
        type: 'VISUAL',
        content: '',
        subtype: 'image'
      });
    }
  };

  const scan = async (): Promise<void> => {
    if (!visualProcessed) {
      const closeIdx = buffer.indexOf(VISUAL_CLOSE);
      if (closeIdx !== -1) {
        const openIdx = buffer.indexOf(VISUAL_OPEN);
        if (openIdx !== -1 && openIdx < closeIdx) {
          const blockXml = buffer.slice(openIdx, closeIdx + VISUAL_CLOSE.length);
          await processVisualBlock(blockXml);
        }
      }
    }

    if (narrativeState === 'before') {
      const openIdx = buffer.indexOf(NARRATIVE_OPEN);
      if (openIdx !== -1) {
        narrativeEmittedIdx = openIdx + NARRATIVE_OPEN.length;
        while (
          narrativeEmittedIdx < buffer.length &&
          /\s/.test(buffer[narrativeEmittedIdx]!)
        ) {
          narrativeEmittedIdx++;
        }
        narrativeState = 'inside';
      }
    }

    if (narrativeState === 'inside') {
      const closeIdx = buffer.indexOf(NARRATIVE_CLOSE, narrativeEmittedIdx);
      if (closeIdx !== -1) {
        let endIdx = closeIdx;
        while (endIdx > narrativeEmittedIdx && /\s/.test(buffer[endIdx - 1]!)) {
          endIdx--;
        }
        const chunk = buffer.slice(narrativeEmittedIdx, endIdx);
        if (chunk) {
          narrativeContent += chunk;
          enqueue({ id: contentPartId, type: 'CONTENT', content: chunk });
        }
        narrativeEmittedIdx = closeIdx + NARRATIVE_CLOSE.length;
        narrativeState = 'done';
      } else {
        const safeEnd = buffer.length - NARRATIVE_CLOSE.length;
        if (safeEnd > narrativeEmittedIdx) {
          const chunk = buffer.slice(narrativeEmittedIdx, safeEnd);
          narrativeContent += chunk;
          enqueue({ id: contentPartId, type: 'CONTENT', content: chunk });
          narrativeEmittedIdx = safeEnd;
        }
      }
    }
  };

  const processActions = async (): Promise<string[]> => {
    const openIdx = buffer.indexOf('<actions>');
    const closeIdx = buffer.indexOf('</actions>');
    if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) return [];
    const blockXml = buffer.slice(openIdx, closeIdx + '</actions>'.length);
    const doc = parse(blockXml);
    return querySelectorAll(doc, 'action')
      .map((el) => getText(el).trim())
      .filter(Boolean);
  };

  const { model, apiKey } = getPiModel('text_chat');

  const streamDone = (async () => {
    try {
      const stream = streamSimple(
        model,
        {
          systemPrompt: chat.systemPrompt ?? '',
          messages: piMessages
        },
        { apiKey, sessionId: uuidv7() }
      );

      for await (const event of stream) {
        if (event.type === 'text_delta') {
          buffer += event.delta;
          await scan();
        } else if (event.type === 'error') {
          throw new Error(event.error.errorMessage || 'LLM stream error');
        }
      }

      await scan();

      if (DEBUG_LOG_RAW_OUTPUT) {
        console.log(`[chat raw output] node ${params.nodeId}:\n${buffer}`);
      }

      if (narrativeContent.trim()) {
        await createChatNodeParts([
          {
            id: contentPartId,
            chatNodeId: params.nodeId,
            type: 'CONTENT',
            idx: 0,
            content: narrativeContent,
            subtype: null
          }
        ]);
      }

      const actions = await processActions();
      if (actions.length > 0) {
        const actionParts = await createChatNodeParts(
          actions.map((action, idx) => ({
            id: uuidv7(),
            chatNodeId: params.nodeId,
            type: 'ACTION' as const,
            idx: idx + 2,
            content: action,
            subtype: null
          }))
        );
        for (const actionPart of actionParts) {
          enqueue({
            id: actionPart.id,
            type: 'ACTION',
            content: actionPart.content
          });
        }
      }

      turnComplete = narrativeState === 'done' && actions.length > 0;

      if (!turnComplete) {
        console.error(
          `Malformed turn output (narrativeState=${narrativeState}, actions=${actions.length})`
        );
        await deleteChatNodePartsByIds(eagerlyWrittenPartIds);
      } else if (!visualProcessed) {
        await createChatNodeParts([
          {
            id: uuidv7(),
            chatNodeId: params.nodeId,
            type: 'VISUAL',
            idx: 1,
            content: previousVisual?.content ?? '',
            contentUrl: previousVisual?.contentUrl ?? null,
            bookEntityIds: previousVisual?.bookEntityIds ?? [],
            subtype: 'none'
          }
        ]);
      }
    } catch (e) {
      console.error(e);
      try {
        await deleteChatNodePartsByIds(eagerlyWrittenPartIds);
      } catch (rollbackErr) {
        console.error(rollbackErr);
      }
      throw e;
    } finally {
      streamRefs.controller?.close();
    }
  })();

  const smoothed = readableStream.pipeThrough(smoothStream({ delayInMs: 2 }));
  const reader = smoothed.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    host.log({ kind: 'chat-stream-chunk', message: value });
  }

  await streamDone;

  // Turn fully written; release the UI before the behind-the-scenes director runs.
  host.log({ kind: 'chat-stream-done' });

  if (turnComplete) {
    const recentPrevious = previousNodes.slice(0, 2).reverse();
    const directorMessages = [
      ...recentPrevious.map((n) => ({
        content: n.parts
          .filter((p) => p.type === 'CONTENT')
          .map((p) => p.content)
          .join('\n'),
        action: n.actionLabel
      })),
      { content: narrativeContent, action: currentNode.actionLabel }
    ];
    try {
      await directChat(directorMessages, {
        userId: DEFAULT_USER_ID,
        nodeId: params.nodeId,
        chatSlug: params.chatSlug
      });
    } catch (e) {
      console.error(e);
    }
  }

  return null;
}
