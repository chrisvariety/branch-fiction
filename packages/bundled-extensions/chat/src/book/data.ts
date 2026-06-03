export async function buildWorld(params: {
  bookId: string;
  bookInteractiveEntities: string[];
}): Promise<{ worldSlug: string; userWorldId: string; reused: boolean }> {
  return window.extensionSDK.worker.spawn('buildWorld', params);
}

export async function generateScenarios(params: {
  userWorldId: string;
  prompt?: string;
}): Promise<void> {
  await window.extensionSDK.worker.spawn('generateScenarios', params);
}

export async function generateWorldImage(params: {
  userWorldId: string;
}): Promise<string> {
  return window.extensionSDK.worker.spawn('generateWorldImage', params);
}

export async function createNewChat(params: {
  scenarioId: string;
  userWorldSlug: string;
}): Promise<{ chatSlug: string }> {
  return window.extensionSDK.worker.spawn('createNewChat', params);
}

export async function loadChatNode(params: {
  chatSlug: string;
  nodeId: string;
}): Promise<{
  id: string;
  parentNodeId: string | null;
  depth: number;
  childrenCount: number;
  actionLabel: string | null;
  parts: {
    id: string;
    type: 'CONTENT' | 'VISUAL' | 'ACTION' | 'INTERNAL_CONTENT';
    content: string;
    contentUrl: string | null;
    subtype: string | null;
    idx: number;
  }[];
  children: {
    id: string;
    depth: number;
    actionLabel: string;
    actionType: string;
    childrenCount: number;
  }[];
}> {
  return window.extensionSDK.worker.spawn('loadChatNode', params);
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
  return window.extensionSDK.worker.spawn('performChatAction', params);
}

export type ChatStreamChunk = {
  id: string;
  type: 'CONTENT' | 'VISUAL' | 'ACTION' | 'INTERNAL_CONTENT';
  content: string;
  subtype?: 'image' | 'video' | 'none';
};

export function streamChatResponse(
  params: { nodeId: string; chatSlug: string },
  onChunk: (chunk: ChatStreamChunk) => void
): Promise<null> & { cancel: () => void } {
  const handle = window.extensionSDK.worker
    .spawn<null>('streamChatResponse', params)
    .onLog((args) => {
      const event = args[0] as { kind?: string; message?: ChatStreamChunk } | undefined;
      if (event?.kind === 'chat-stream-chunk' && event.message) {
        onChunk(event.message);
      }
    });
  return handle;
}

export async function generateChatImage(params: {
  chatMessagePartId: string;
}): Promise<string> {
  return window.extensionSDK.worker.spawn('generateChatImage', params);
}
