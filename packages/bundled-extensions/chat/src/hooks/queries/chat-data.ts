import { queryOptions } from '@tanstack/react-query';

import {
  getChatHistoryFromCurrentLeafNodeByUserIdAndSlug,
  getChatNodeCountByChatId,
  getChatWithUserWorldByUserIdAndSlug
} from '@/iframe/db/models/chat/get-chat';
import { DEFAULT_USER_ID } from '@/lib/auth';
import type { ChatNodePart } from '@/lib/db/types';
import { transformImageUrl } from '@/lib/media/transform-url';

export type ChatLeafNodeData = {
  id: string;
  parentNodeId: string | null;
  depth: number;
  childrenCount: number;
  actionLabel: string | null;
  shouldGenerateVisual: boolean;
  parts: Array<{
    id: string;
    type: ChatNodePart['type'];
    content: string;
    contentUrl: string | null;
    subtype: ChatNodePart['subtype'];
  }>;
  children: Array<{
    id: string;
    depth: number;
    actionLabel: string;
    actionType: string;
    childrenCount: number;
  }>;
};

export type ChatData = {
  nodeCount: number | null;
  topCharacters: string[];
  chat: {
    id: string;
    title: string;
    accessType: 'public' | 'demo' | 'preview' | null;
    userWorld: { slug: string; title: string } | null;
    playerEntity: { name: string; imageUrl: string | null } | null;
    currentLeafNode: ChatLeafNodeData;
    nodeStack: ChatLeafNodeData[];
  };
};

async function fetchChat(chatSlug: string): Promise<ChatData> {
  const [chat, historyRows] = await Promise.all([
    getChatWithUserWorldByUserIdAndSlug(DEFAULT_USER_ID, chatSlug),
    getChatHistoryFromCurrentLeafNodeByUserIdAndSlug(DEFAULT_USER_ID, chatSlug)
  ]);
  if (!chat) throw new Error('Chat not found');
  if (!chat.currentLeafNodeId) throw new Error('Chat is not active');
  if (historyRows.length === 0) throw new Error('Chat history is empty');

  const nodeCount =
    chat.accessType === 'demo' ? await getChatNodeCountByChatId(chat.id) : null;

  const userWorld = chat.userWorld
    ? { slug: chat.userWorld.slug, title: chat.userWorld.title }
    : null;

  const nodeDataMap = new Map<string, ChatLeafNodeData>();
  for (const row of historyRows) {
    if (!nodeDataMap.has(row.nodeId)) {
      nodeDataMap.set(row.nodeId, {
        id: row.nodeId,
        parentNodeId: row.parentNodeId,
        depth: row.depth,
        childrenCount: row.childrenCount,
        actionLabel: row.actionLabel,
        shouldGenerateVisual: row.shouldGenerateVisual,
        parts: [],
        children: (row.directChildren ?? []).map((c) => ({
          id: c.id,
          depth: row.depth + 1,
          actionLabel: c.actionLabel,
          actionType: c.actionType,
          childrenCount: c.childrenCount
        }))
      });
    }
    const nodeData = nodeDataMap.get(row.nodeId)!;
    if (row.partId && row.type && row.type !== 'INTERNAL_CONTENT') {
      nodeData.parts.push({
        id: row.partId,
        type: row.type,
        content: row.type === 'VISUAL' ? '' : (row.content ?? ''),
        contentUrl: row.contentUrl ?? null,
        subtype: row.subtype ?? null
      });
    }
  }
  const nodeStack = Array.from(nodeDataMap.values()).sort((a, b) => a.depth - b.depth);
  const currentLeafNode = nodeStack[nodeStack.length - 1];

  const firstEntity = chat.chatEntities[0];
  const playerImageUrl = firstEntity?.refImageUrl ?? firstEntity?.imageUrl ?? null;
  const playerEntity = firstEntity
    ? {
        name: firstEntity.name,
        imageUrl: playerImageUrl
          ? transformImageUrl(playerImageUrl, { variant: 'thumb' })
          : null
      }
    : null;

  return {
    nodeCount,
    topCharacters: chat.chatEntities
      .filter((e) => e.type === 'CHARACTER')
      .map((e) => e.name),
    chat: {
      id: chat.id,
      title: chat.title,
      accessType: chat.accessType,
      userWorld,
      playerEntity,
      currentLeafNode,
      nodeStack
    }
  };
}

export function chatQueryOptions(chatSlug: string) {
  return queryOptions({
    queryKey: ['chat', chatSlug],
    queryFn: () => fetchChat(chatSlug),
    staleTime: Infinity
  });
}
