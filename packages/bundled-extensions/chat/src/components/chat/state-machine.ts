import type { ChatNodePart } from '@/lib/db/types';

// === Types ===

export type NodePart = {
  id: string;
  type: ChatNodePart['type'];
  content: string;
  contentUrl?: string | null;
  subtype?: ChatNodePart['subtype'];
};

export type ChatChildNode = {
  id: string;
  depth: number;
  actionLabel: string;
  actionType: string;
  childrenCount: number;
};

export type ChatLeafNode = {
  id: string;
  depth: number;
  childrenCount: number;
  parentNodeId?: string | null;
  actionLabel?: string | null;
  shouldGenerateVisual?: boolean;
  parts: NodePart[];
  children: ChatChildNode[];
};

export type StreamChunk = {
  id: string;
  type: ChatNodePart['type'];
  content: string;
  subtype?: NonNullable<ChatNodePart['subtype']>;
};

export type ChatState = {
  nodeStack: ChatLeafNode[];
  cursorIndex: number;
  latestLeafNodeId: string;
  chatId: string;
  // Parts where image generation was triggered and we're waiting for full load
  pendingImagePartIds: string[];
  // Child node currently being loaded (for GO_FORWARD to existing branch)
  loadingChildId: string | null;
  // Node whose turn output is actively streaming (cleared when output is done)
  streamingNodeId: string | null;
  // Stream completed but no ACTION parts were received
  streamFailed: boolean;
};

export type ChatAction =
  | { type: 'GO_BACK'; fromIndex: number }
  | { type: 'GO_TO_INDEX'; index: number }
  | { type: 'GO_FORWARD'; child: ChatChildNode; fromIndex: number }
  | {
      type: 'PERFORM_ACTION';
      content: string;
      parentNodeId: string;
      parentIndex: number;
      newNodeId: string;
      newNodeDepth: number;
      newNodeChildrenCount: number;
      shouldGenerateVisual: boolean;
    }
  | { type: 'APPEND_STREAM_CHUNK'; nodeId: string; chunk: StreamChunk }
  | { type: 'UPDATE_IMAGE_URL'; partId: string; imageUrl: string }
  | { type: 'SET_LOADED_NODE'; parentIndex: number; node: ChatLeafNode }
  | {
      type: 'RESET_FOR_CHAT';
      chatId: string;
      nodeStack: ChatLeafNode[];
      currentLeafNodeId: string;
    }
  | { type: 'IMAGE_GENERATION_STARTED'; partId: string }
  | { type: 'IMAGE_LOADED'; partId: string }
  | { type: 'IMAGE_GENERATION_FAILED'; partId: string }
  | { type: 'STREAM_COMPLETED'; nodeId: string }
  | { type: 'RETRY_NODE'; nodeId: string };

export type ChatEffectIntent =
  | { type: 'SCROLL_TO_INDEX'; index: number; behavior: ScrollBehavior }
  | { type: 'TRIGGER_IMAGE_GENERATION'; partId: string }
  | { type: 'LOAD_NODE'; nodeId: string; parentIndex: number };

// === Reducer Factory ===

export function createChatReducer() {
  return function chatReducer(state: ChatState, action: ChatAction): ChatState {
    if (action.type !== 'APPEND_STREAM_CHUNK') console.log('action', action);

    switch (action.type) {
      case 'GO_BACK': {
        const targetIndex = Math.max(action.fromIndex - 1, 0);
        return {
          ...state,
          cursorIndex: targetIndex,
          streamFailed: false
        };
      }

      case 'GO_TO_INDEX': {
        return {
          ...state,
          cursorIndex: action.index,
          streamFailed: false
        };
      }

      case 'GO_FORWARD': {
        const { child, fromIndex } = action;
        const targetIndex = fromIndex + 1;
        const existingNode = state.nodeStack[targetIndex];

        // If node already exists with data loaded, just update cursor
        if (
          existingNode &&
          existingNode.id === child.id &&
          existingNode.parts.length > 0
        ) {
          return {
            ...state,
            cursorIndex: targetIndex,
            loadingChildId: null,
            streamFailed: false
          };
        }

        // Node needs to be loaded - just mark it as loading, don't change cursor yet
        return {
          ...state,
          loadingChildId: child.id,
          streamFailed: false
        };
      }

      case 'PERFORM_ACTION': {
        const {
          content,
          parentNodeId,
          parentIndex,
          newNodeId,
          newNodeDepth,
          newNodeChildrenCount,
          shouldGenerateVisual
        } = action;

        const parentNode = state.nodeStack[parentIndex];
        if (!parentNode || parentNode.id !== parentNodeId) {
          return state;
        }

        const isChoice = parentNode.parts.some(
          (p) => p.type === 'ACTION' && p.content === content
        );

        const nextChild: ChatChildNode = {
          id: newNodeId,
          depth: newNodeDepth,
          actionLabel: content,
          actionType: isChoice ? 'choice' : 'custom_input',
          childrenCount: 0
        };

        const existing = parentNode.children.some((c) => c.id === newNodeId);
        const nextChildren = existing
          ? parentNode.children
          : [...parentNode.children, nextChild];

        const updatedParent: ChatLeafNode = {
          ...parentNode,
          children: nextChildren,
          childrenCount: Math.max(parentNode.childrenCount, nextChildren.length)
        };

        const placeholderNode: ChatLeafNode = {
          parentNodeId,
          id: newNodeId,
          parts: [],
          actionLabel: content,
          childrenCount: newNodeChildrenCount,
          depth: newNodeDepth,
          shouldGenerateVisual,
          children: []
        };

        const trimmedStack = state.nodeStack.slice(0, parentIndex + 1);
        trimmedStack[parentIndex] = updatedParent;

        return {
          ...state,
          nodeStack: [...trimmedStack, placeholderNode],
          latestLeafNodeId: newNodeId,
          cursorIndex: parentIndex + 1,
          streamingNodeId: newNodeId,
          streamFailed: false
        };
      }

      case 'APPEND_STREAM_CHUNK': {
        const { nodeId, chunk } = action;
        const nodeIndex = state.nodeStack.findIndex((n) => n.id === nodeId);
        if (nodeIndex === -1) return state;

        const node = state.nodeStack[nodeIndex];
        const existingPartIndex = node.parts.findIndex((p) => p.id === chunk.id);
        let updatedParts: NodePart[];

        if (chunk.type === 'CONTENT') {
          if (existingPartIndex !== -1) {
            updatedParts = node.parts.map((p) =>
              p.id === chunk.id ? { ...p, content: (p.content || '') + chunk.content } : p
            );
          } else {
            updatedParts = [
              ...node.parts,
              { id: chunk.id, type: 'CONTENT' as const, content: chunk.content }
            ];
          }
        } else if (chunk.type === 'VISUAL') {
          if (existingPartIndex !== -1) {
            updatedParts = node.parts.map((p) =>
              p.id === chunk.id
                ? {
                    ...p,
                    content: chunk.content,
                    subtype: chunk.subtype || 'image'
                  }
                : p
            );
          } else {
            updatedParts = [
              ...node.parts,
              {
                id: chunk.id,
                type: 'VISUAL' as const,
                content: chunk.content,
                subtype: chunk.subtype || 'image'
              }
            ];
          }
        } else if (chunk.type === 'ACTION') {
          if (existingPartIndex !== -1) {
            updatedParts = node.parts.map((p) =>
              p.id === chunk.id ? { ...p, content: chunk.content } : p
            );
          } else {
            updatedParts = [
              ...node.parts,
              { id: chunk.id, type: 'ACTION' as const, content: chunk.content }
            ];
          }
        } else {
          return state;
        }

        const updatedNode = { ...node, parts: updatedParts };
        const nextStack = [...state.nodeStack];
        nextStack[nodeIndex] = updatedNode;

        return {
          ...state,
          nodeStack: nextStack
        };
      }

      case 'UPDATE_IMAGE_URL': {
        const { partId, imageUrl } = action;
        const nodeIndex = state.nodeStack.findIndex((node) =>
          node.parts.some((p) => p.id === partId)
        );

        if (nodeIndex === -1) return state;

        const node = state.nodeStack[nodeIndex];
        const updatedNode = {
          ...node,
          parts: node.parts.map((part) =>
            part.id === partId ? { ...part, contentUrl: imageUrl } : part
          )
        };

        const nextStack = [...state.nodeStack];
        nextStack[nodeIndex] = updatedNode;

        return {
          ...state,
          nodeStack: nextStack
        };
      }

      case 'SET_LOADED_NODE': {
        const { parentIndex, node } = action;
        const targetIndex = parentIndex + 1;

        // Only process if this is the node we're waiting for
        if (state.loadingChildId !== node.id) {
          return state;
        }

        // Trim stack to parent and add the loaded node
        const trimmedStack = state.nodeStack.slice(0, targetIndex);

        return {
          ...state,
          nodeStack: [...trimmedStack, node],
          cursorIndex: targetIndex,
          loadingChildId: null,
          streamFailed: false
        };
      }

      case 'RESET_FOR_CHAT': {
        const { chatId, nodeStack, currentLeafNodeId } = action;
        return {
          chatId,
          nodeStack,
          cursorIndex: Math.max(0, nodeStack.length - 1),
          latestLeafNodeId: currentLeafNodeId,
          pendingImagePartIds: [],
          loadingChildId: null,
          streamingNodeId: deriveStreamingNodeId(nodeStack, currentLeafNodeId),
          streamFailed: false
        };
      }

      case 'IMAGE_GENERATION_STARTED': {
        const { partId } = action;
        if (state.pendingImagePartIds.includes(partId)) {
          return state;
        }
        return {
          ...state,
          pendingImagePartIds: [...state.pendingImagePartIds, partId]
        };
      }

      case 'IMAGE_LOADED': {
        const { partId } = action;
        return {
          ...state,
          pendingImagePartIds: state.pendingImagePartIds.filter((id) => id !== partId)
        };
      }

      case 'IMAGE_GENERATION_FAILED': {
        const { partId } = action;
        return {
          ...state,
          pendingImagePartIds: state.pendingImagePartIds.filter((id) => id !== partId)
        };
      }

      case 'STREAM_COMPLETED': {
        const node = state.nodeStack.find((n) => n.id === action.nodeId);
        if (!node) return state;
        const hasActions = node.parts.some((p) => p.type === 'ACTION');
        return {
          ...state,
          streamingNodeId:
            state.streamingNodeId === action.nodeId ? null : state.streamingNodeId,
          streamFailed: !hasActions
        };
      }

      case 'RETRY_NODE': {
        const nodeIndex = state.nodeStack.findIndex((n) => n.id === action.nodeId);
        if (nodeIndex === -1) return state;
        const node = state.nodeStack[nodeIndex];
        const clearedPartIds = new Set(node.parts.map((p) => p.id));
        const nextStack = [...state.nodeStack];
        nextStack[nodeIndex] = { ...node, parts: [] };
        return {
          ...state,
          nodeStack: nextStack,
          streamingNodeId: action.nodeId,
          streamFailed: false,
          pendingImagePartIds: state.pendingImagePartIds.filter(
            (id) => !clearedPartIds.has(id)
          )
        };
      }

      default:
        return state;
    }
  };
}

// === Effect Derivation ===

export function getTransitionEffects(
  _prevState: ChatState,
  nextState: ChatState,
  action: ChatAction
): ChatEffectIntent[] {
  const effects: ChatEffectIntent[] = [];

  switch (action.type) {
    case 'GO_BACK': {
      const targetIndex = Math.max(action.fromIndex - 1, 0);
      effects.push({ type: 'SCROLL_TO_INDEX', index: targetIndex, behavior: 'smooth' });
      break;
    }

    case 'GO_TO_INDEX': {
      effects.push({ type: 'SCROLL_TO_INDEX', index: action.index, behavior: 'smooth' });
      break;
    }

    case 'GO_FORWARD': {
      const targetIndex = action.fromIndex + 1;
      const existingNode = nextState.nodeStack[targetIndex];

      // If the correct node already exists with data, scroll to it
      if (
        existingNode &&
        existingNode.id === action.child.id &&
        existingNode.parts.length > 0
      ) {
        effects.push({ type: 'SCROLL_TO_INDEX', index: targetIndex, behavior: 'smooth' });
      } else {
        // Node needs to be loaded
        effects.push({
          type: 'LOAD_NODE',
          nodeId: action.child.id,
          parentIndex: action.fromIndex
        });
      }
      break;
    }

    case 'PERFORM_ACTION': {
      const targetIndex = action.parentIndex + 1;
      effects.push({ type: 'SCROLL_TO_INDEX', index: targetIndex, behavior: 'smooth' });
      break;
    }

    case 'APPEND_STREAM_CHUNK': {
      // Trigger image generation for visual parts
      if (action.chunk.type === 'VISUAL' && action.chunk.subtype === 'image') {
        effects.push({ type: 'TRIGGER_IMAGE_GENERATION', partId: action.chunk.id });
      }
      break;
    }

    case 'SET_LOADED_NODE': {
      // Scroll to the newly loaded node
      const targetIndex = action.parentIndex + 1;
      effects.push({ type: 'SCROLL_TO_INDEX', index: targetIndex, behavior: 'smooth' });
      break;
    }
  }

  return effects;
}

// === Initial State Factory ===

export function createInitialState(
  chatId: string,
  nodeStack: ChatLeafNode[],
  currentLeafNodeId: string
): ChatState {
  return {
    chatId,
    nodeStack,
    cursorIndex: Math.max(0, nodeStack.length - 1),
    latestLeafNodeId: currentLeafNodeId,
    pendingImagePartIds: [],
    loadingChildId: null,
    streamingNodeId: deriveStreamingNodeId(nodeStack, currentLeafNodeId),
    streamFailed: false
  };
}

function deriveStreamingNodeId(
  nodeStack: ChatLeafNode[],
  leafNodeId: string
): string | null {
  const leaf = nodeStack.find((n) => n.id === leafNodeId);
  return leaf && leaf.parts.length === 0 ? leafNodeId : null;
}

export function getLatestLeafNode(state: ChatState): ChatLeafNode | null {
  return state.nodeStack.find((n) => n.id === state.latestLeafNodeId) ?? null;
}

export function shouldStreamResponse(state: ChatState): boolean {
  const latestLeafNode = getLatestLeafNode(state);
  return !!latestLeafNode && latestLeafNode.parts.length === 0;
}

export function isStreamingResponse(state: ChatState): boolean {
  return state.streamingNodeId === state.latestLeafNodeId;
}
