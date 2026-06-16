import { useMemo, useReducer } from 'react';

import {
  createChatReducer,
  createInitialState,
  getLatestLeafNode,
  getTransitionEffects,
  isStreamingResponse,
  shouldStreamResponse,
  type ChatAction,
  type ChatEffectIntent,
  type ChatLeafNode,
  type StreamChunk
} from './state-machine';

export type { ChatEffectIntent };

type UseChatStateOptions = {
  initialChatId: string;
  initialNodeStack: ChatLeafNode[];
  initialLeafNodeId: string;
};

export function useChatState({
  initialChatId,
  initialNodeStack,
  initialLeafNodeId
}: UseChatStateOptions) {
  const reducer = useMemo(() => createChatReducer(), []);

  const [state, baseDispatch] = useReducer(
    reducer,
    { chatId: initialChatId, nodeStack: initialNodeStack, leafNodeId: initialLeafNodeId },
    (init) => createInitialState(init.chatId, init.nodeStack, init.leafNodeId)
  );

  // Dispatch that returns effect intents for the caller to execute
  const dispatchWithEffects = (action: ChatAction): ChatEffectIntent[] => {
    const prevState = state;
    baseDispatch(action);
    // Compute effects based on what the next state WILL be by running the reducer
    const nextState = reducer(prevState, action);
    return getTransitionEffects(prevState, nextState, action);
  };

  // Derived values
  const latestLeafNode = getLatestLeafNode(state);
  const shouldStream = shouldStreamResponse(state);
  const isStreaming = isStreamingResponse(state);

  // === Action helpers ===

  const goBack = (fromIndex: number): ChatEffectIntent[] => {
    return dispatchWithEffects({ type: 'GO_BACK', fromIndex });
  };
  const goToIndex = (index: number): ChatEffectIntent[] => {
    return dispatchWithEffects({ type: 'GO_TO_INDEX', index });
  };

  const goForward = (
    fromIndex: number,
    child: ChatLeafNode['children'][number]
  ): ChatEffectIntent[] => {
    return dispatchWithEffects({ type: 'GO_FORWARD', child, fromIndex });
  };

  const performAction = (args: {
    content: string;
    parentNodeId: string;
    parentIndex: number;
    newNodeId: string;
    newNodeDepth: number;
    newNodeChildrenCount: number;
    shouldGenerateVisual: boolean;
  }): ChatEffectIntent[] => {
    return dispatchWithEffects({
      type: 'PERFORM_ACTION',
      ...args
    });
  };

  const appendStreamChunk = (nodeId: string, chunk: StreamChunk): ChatEffectIntent[] => {
    return dispatchWithEffects({
      type: 'APPEND_STREAM_CHUNK',
      nodeId,
      chunk
    });
  };

  const updateImageUrl = (partId: string, imageUrl: string): ChatEffectIntent[] => {
    return dispatchWithEffects({
      type: 'UPDATE_IMAGE_URL',
      partId,
      imageUrl
    });
  };
  const setLoadedNode = (parentIndex: number, node: ChatLeafNode): ChatEffectIntent[] => {
    return dispatchWithEffects({
      type: 'SET_LOADED_NODE',
      parentIndex,
      node
    });
  };

  const resetForChat = (
    chatId: string,
    nodeStack: ChatLeafNode[],
    currentLeafNodeId: string
  ): ChatEffectIntent[] => {
    return dispatchWithEffects({
      type: 'RESET_FOR_CHAT',
      chatId,
      nodeStack,
      currentLeafNodeId
    });
  };

  const imageGenerationStarted = (partId: string): ChatEffectIntent[] => {
    return dispatchWithEffects({
      type: 'IMAGE_GENERATION_STARTED',
      partId
    });
  };

  const imageLoaded = (partId: string): ChatEffectIntent[] => {
    return dispatchWithEffects({
      type: 'IMAGE_LOADED',
      partId
    });
  };

  const imageGenerationFailed = (partId: string): ChatEffectIntent[] => {
    return dispatchWithEffects({
      type: 'IMAGE_GENERATION_FAILED',
      partId
    });
  };

  const streamCompleted = (nodeId: string): ChatEffectIntent[] => {
    return dispatchWithEffects({
      type: 'STREAM_COMPLETED',
      nodeId
    });
  };

  const retryNode = (nodeId: string): ChatEffectIntent[] => {
    return dispatchWithEffects({
      type: 'RETRY_NODE',
      nodeId
    });
  };

  return {
    state,
    dispatch: dispatchWithEffects,

    // Derived state
    latestLeafNode,
    shouldStream,
    isStreaming,

    // Action helpers
    goBack,
    goToIndex,
    goForward,
    performAction,
    appendStreamChunk,
    updateImageUrl,
    setLoadedNode,
    resetForChat,
    imageGenerationStarted,
    imageLoaded,
    imageGenerationFailed,
    streamCompleted,
    retryNode
  };
}

// Re-export types from state-machine for convenience
export type {
  ChatAction,
  ChatLeafNode,
  ChatState,
  NodePart,
  StreamChunk
} from './state-machine';
