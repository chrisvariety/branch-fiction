import { IconChevronLeft, IconPencil } from '@tabler/icons-react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery
} from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Container, HeaderContainer } from '@/components/chat/container';
import { ChatNodeScreen } from '@/components/chat/node';
import {
  useChatState,
  type ChatEffectIntent,
  type ChatLeafNode
} from '@/components/chat/use-chat-state';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { chatQueryOptions } from '@/hooks/queries/chat-data';
import { updateChatTitleById } from '@/iframe/db/models/chat/update-chat';

import {
  generateChatImage,
  loadChatNode,
  performChatAction,
  streamChatResponse
} from '../book/data';

type BookCtx = ExtensionCtx & { bookId: string };

type Props = {
  ctx: BookCtx;
  chatSlug: string;
  fromWorld: boolean;
};

export function Chat({ chatSlug, fromWorld }: Props) {
  return (
    <Suspense fallback={<CenteredLoader />}>
      <ChatInner chatSlug={chatSlug} fromWorld={fromWorld} />
    </Suspense>
  );
}

function ChatInner({ chatSlug, fromWorld }: { chatSlug: string; fromWorld: boolean }) {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(chatQueryOptions(chatSlug));
  const { chat, topCharacters, nodeCount } = data;

  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const [titleDraft, setTitleDraft] = useState(chat.title);
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  const handleUpdateTitle = async () => {
    if (!titleDraft.trim() || titleDraft.trim() === title) {
      setIsEditing(false);
      setTitleDraft(title);
      return;
    }
    setIsSavingTitle(true);
    try {
      await updateChatTitleById(chat.id, titleDraft.trim());
      setTitle(titleDraft.trim());
      setIsEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['chat', chatSlug] });
    } catch (e) {
      console.error('Failed to update title:', e);
      toast.error('Failed to update title');
    } finally {
      setIsSavingTitle(false);
    }
  };

  const {
    state,
    shouldStream,
    isStreaming,
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
  } = useChatState({
    initialChatId: chat.id,
    initialNodeStack: chat.nodeStack,
    initialLeafNodeId: chat.currentLeafNode.id
  });

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const screenRefsByIndex = useRef<Record<number, HTMLElement | null>>({});
  const didInitialScrollRef = useRef(state.nodeStack.length === 1);
  const [visibleNodeIndex, setVisibleNodeIndex] = useState<number | null>(null);
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const lastScrollTopRef = useRef(0);
  const programmaticScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const [hasLiftedAction, setHasLiftedAction] = useState(false);
  const [messageCount, setMessageCount] = useState<number | null>(nodeCount);

  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior) => {
    const sectionEl = screenRefsByIndex.current[index];
    if (!sectionEl) return;

    isProgrammaticScrollRef.current = true;
    setShowStickyHeader(false);
    if (programmaticScrollTimeoutRef.current) {
      clearTimeout(programmaticScrollTimeoutRef.current);
    }
    programmaticScrollTimeoutRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 1000);

    sectionEl.scrollIntoView({ behavior, block: 'start' });
  }, []);

  const scrollToIndexSoon = useCallback(
    (index: number, behavior: ScrollBehavior) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToIndex(index, behavior);
        });
      });
    },
    [scrollToIndex]
  );

  const { mutate: triggerImageGeneration } = useMutation({
    mutationKey: ['generateChatImage'],
    scope: { id: 'generateChatImage' },
    mutationFn: ({ partId }: { partId: string }) =>
      generateChatImage({ chatMessagePartId: partId }),
    onSuccess: (imageUrl, { partId }) => {
      updateImageUrl(partId, imageUrl);
    },
    onError: (_error, { partId }) => {
      imageGenerationFailed(partId);
    }
  });

  const { mutate: loadNodeMutation } = useMutation({
    mutationKey: ['loadNode'],
    mutationFn: async ({
      nodeId,
      parentIndex
    }: {
      nodeId: string;
      parentIndex: number;
    }) => {
      const loaded = await loadChatNode({ nodeId, chatSlug });
      const loadedNode: ChatLeafNode = {
        id: loaded.id,
        parentNodeId: loaded.parentNodeId,
        depth: loaded.depth,
        childrenCount: loaded.childrenCount,
        actionLabel: loaded.actionLabel,
        parts: loaded.parts.map((part) => ({
          id: part.id,
          type: part.type,
          content: part.content,
          contentUrl: part.contentUrl,
          subtype: part.subtype as ChatLeafNode['parts'][number]['subtype']
        })),
        children: loaded.children.map((c) => ({
          id: c.id,
          depth: c.depth,
          actionLabel: c.actionLabel,
          actionType: c.actionType,
          childrenCount: c.childrenCount
        }))
      };
      return { loadedNode, parentIndex };
    },
    onSuccess: ({ loadedNode, parentIndex }) => {
      const effects = setLoadedNode(parentIndex, loadedNode);
      executeEffects(effects);
    },
    onError: (e) => {
      console.error(e);
      toast.error('Failed to load node');
    }
  });

  const executeEffects = (effects: ChatEffectIntent[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'SCROLL_TO_INDEX':
          scrollToIndexSoon(effect.index, effect.behavior);
          break;
        case 'TRIGGER_IMAGE_GENERATION':
          imageGenerationStarted(effect.partId);
          triggerImageGeneration({ partId: effect.partId });
          break;
        case 'LOAD_NODE':
          loadNodeMutation({ nodeId: effect.nodeId, parentIndex: effect.parentIndex });
          break;
      }
    }
  };

  const { mutate: performActionMutation, reset: resetPerformAction } = useMutation({
    mutationKey: ['performAction'],
    mutationFn: async ({
      parentNodeId,
      parentIndex,
      content
    }: {
      content: string;
      parentNodeId: string;
      parentIndex: number;
    }) => {
      const result = await performChatAction({
        action: content,
        chatSlug,
        parentNodeId
      });

      const {
        id: nodeId,
        depth: nodeDepth,
        childrenCount: nodeChildrenCount,
        shouldGenerateVisual
      } = result.node;

      const effects = performAction({
        content,
        parentNodeId,
        parentIndex,
        newNodeId: nodeId,
        newNodeDepth: nodeDepth,
        newNodeChildrenCount: nodeChildrenCount,
        shouldGenerateVisual
      });
      executeEffects(effects);

      return { nodeId, nodeIndex: parentIndex + 1 };
    },
    onError: (e) => {
      toast.error(e.message);
      setHasLiftedAction(false);
      setMessageCount((c) => (c === null ? null : c - 1));
    }
  });

  const { error: streamError, refetch: refetchStream } = useQuery({
    queryKey: ['streamChatResponse', state.latestLeafNodeId, chatSlug],
    queryFn: async () => {
      if (!state.latestLeafNodeId) return null;
      const nodeId = state.latestLeafNodeId;

      try {
        await streamChatResponse(
          { nodeId, chatSlug },
          (chunk) => {
            const effects = appendStreamChunk(nodeId, chunk);
            executeEffects(effects);
          },
          // Fired on 'chat-stream-done', before the behind-the-scenes director runs.
          () => streamCompleted(nodeId)
        );
      } catch (e) {
        streamCompleted(nodeId);
        throw e;
      }

      return null;
    },
    enabled: shouldStream,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: false
  });

  useEffect(() => {
    if (streamError) {
      toast.error(
        `Failed to generate response: ${streamError.message || 'Unknown Error'}`
      );
    }
  }, [streamError]);

  const showActionLabelAsCard = isStreaming && hasLiftedAction;

  const [prevChatId, setPrevChatId] = useState(chat.id);
  const [prevLeafNodeId, setPrevLeafNodeId] = useState(chat.currentLeafNode.id);

  if (prevChatId !== chat.id || prevLeafNodeId !== chat.currentLeafNode.id) {
    setPrevChatId(chat.id);
    setPrevLeafNodeId(chat.currentLeafNode.id);
    resetForChat(chat.id, chat.nodeStack, chat.currentLeafNode.id);
    didInitialScrollRef.current = false;
    resetPerformAction();
    setTitle(chat.title);
    setTitleDraft(chat.title);
    setIsEditing(false);
    setMessageCount(nodeCount);
    setHasLiftedAction(false);
  }

  const handleActionSelect = (args: {
    content: string;
    parentNodeId: string;
    parentIndex: number;
  }) => {
    setHasLiftedAction(true);
    setMessageCount((c) => (c === null ? null : c + 1));
    performActionMutation(args);
  };

  const handleGoBack = (fromIndex: number) => {
    const effects = goBack(fromIndex);
    executeEffects(effects);
  };

  const handleRedo = (toIndex: number) => {
    const effects = goToIndex(toIndex);
    executeEffects(effects);
  };

  const handleGoForward = (
    fromIndex: number,
    child: ChatLeafNode['children'][number]
  ) => {
    const effects = goForward(fromIndex, child);
    executeEffects(effects);
  };

  const handleStartOver = () => {
    const effects = goToIndex(0);
    executeEffects(effects);
  };

  const handleGenerateImage = (partId: string) => {
    imageGenerationStarted(partId);
    triggerImageGeneration({ partId });
  };

  const handleRetry = () => {
    const lastIndex = state.nodeStack.length - 1;
    const failedNode = state.nodeStack[lastIndex];
    if (!failedNode) return;
    if (!failedNode.parentNodeId) {
      retryNode(failedNode.id);
      void refetchStream();
      return;
    }
    if (!failedNode.actionLabel) return;
    const parentIndex = lastIndex - 1;
    handleActionSelect({
      content: failedNode.actionLabel,
      parentNodeId: failedNode.parentNodeId,
      parentIndex
    });
  };

  useEffect(() => {
    if (didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    scrollToIndexSoon(state.cursorIndex, 'auto');
  }, [state.cursorIndex, scrollToIndexSoon]);

  const handleContainerScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop } = container;

    const containerRect = container.getBoundingClientRect();
    const viewportTop = containerRect.top;

    let closestIndex: number | null = null;
    let closestDistance = Infinity;

    for (const [indexStr, el] of Object.entries(screenRefsByIndex.current)) {
      if (!el) continue;
      const index = parseInt(indexStr, 10);
      const rect = el.getBoundingClientRect();
      const distance = Math.abs(rect.top - viewportTop);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }

    setVisibleNodeIndex(closestIndex);

    if (!isProgrammaticScrollRef.current) {
      const scrollDelta = scrollTop - lastScrollTopRef.current;
      const isScrollingUp = scrollDelta < -5;
      const isScrollingDown = scrollDelta > 5;
      const isAtTop = scrollTop < 50;

      if (isAtTop) {
        setShowStickyHeader(false);
      } else if (isScrollingUp) {
        setShowStickyHeader(true);
      } else if (isScrollingDown) {
        setShowStickyHeader(false);
      }
    }

    lastScrollTopRef.current = scrollTop;
  }, []);

  const lastNodeIndex = state.nodeStack.length - 1;
  const showScrollToBottom =
    visibleNodeIndex !== null && visibleNodeIndex < lastNodeIndex;

  const handleScrollToBottom = () => {
    scrollToIndex(lastNodeIndex, 'smooth');
  };

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleContainerScroll}
      className="h-svh overflow-y-auto scroll-smooth"
    >
      <Container className="pb-16">
        <HeaderContainer
          className={
            showStickyHeader && !showActionLabelAsCard
              ? 'sticky top-0 z-40 bg-background/95 shadow-sm backdrop-blur-sm transition-all'
              : 'bg-background'
          }
        >
          <div className="flex w-full items-center">
            <div className="w-12 shrink-0">
              {fromWorld && chat.userWorld?.slug ? (
                <Link
                  to="/world/$worldSlug"
                  params={{ worldSlug: chat.userWorld.slug }}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-lg hover:text-foreground"
                >
                  <IconChevronLeft className="h-6 w-6" />
                </Link>
              ) : (
                <Link
                  to="/"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-lg hover:text-foreground"
                >
                  <IconChevronLeft className="h-6 w-6" />
                </Link>
              )}
            </div>
            {isEditing ? (
              <InputGroup className="mr-4 ml-2 flex-1 bg-background">
                <InputGroupInput
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleUpdateTitle();
                    if (e.key === 'Escape') {
                      setIsEditing(false);
                      setTitleDraft(title);
                    }
                  }}
                  autoFocus
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    variant="default"
                    onClick={() => void handleUpdateTitle()}
                    disabled={isSavingTitle}
                  >
                    {isSavingTitle ? 'Updating…' : 'Update'}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            ) : (
              <button
                type="button"
                className="mx-2 flex min-w-0 flex-1 items-center justify-center gap-2 font-sans text-base font-medium"
                onClick={() => setIsEditing(true)}
              >
                <span className="truncate">{title}</span>
                <IconPencil className="size-4 shrink-0 text-muted-foreground" />
              </button>
            )}
            <div className="flex w-12 shrink-0 justify-end">
              {chat.playerEntity?.name ? (
                <Popover>
                  <PopoverTrigger>
                    {chat.playerEntity.imageUrl ? (
                      <img
                        src={chat.playerEntity.imageUrl}
                        alt={chat.playerEntity.name}
                        className="h-12 w-12 rounded-full border border-border object-cover shadow-lg ring-2 ring-background/60"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground shadow-lg ring-2 ring-background/60">
                        {chat.playerEntity.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </PopoverTrigger>
                  <PopoverContent side="bottom" className="w-auto">
                    <span>You're playing as {chat.playerEntity.name}</span>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
          </div>
        </HeaderContainer>

        {showScrollToBottom && !showActionLabelAsCard && (
          <button
            type="button"
            onClick={handleScrollToBottom}
            className="fixed bottom-6 left-1/2 z-50 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-lg transition-all hover:text-foreground"
            aria-label="Scroll to bottom"
          >
            ↓
          </button>
        )}

        {state.nodeStack.map((node, index) => {
          const isLatestLeafScreen = node.id === state.latestLeafNodeId;

          const prevNode = index > 0 ? state.nodeStack[index - 1] : null;
          const prevVisualPart = prevNode?.parts.find(
            (part) => part.type === 'VISUAL' && part.subtype === 'image'
          );
          const prevImageUrl = prevVisualPart?.contentUrl ?? null;

          const imagePart = node.parts.find(
            (p) => p.type === 'VISUAL' && p.subtype === 'image'
          );
          const isImagePending = imagePart
            ? state.pendingImagePartIds.includes(imagePart.id)
            : false;

          return (
            <section
              key={node.id}
              ref={(el) => {
                screenRefsByIndex.current[index] = el;
              }}
              className={isLatestLeafScreen ? 'min-h-dvh' : undefined}
            >
              <ChatNodeScreen
                node={node}
                nodeIndex={index}
                cursorIndex={state.cursorIndex}
                isFirstNode={index === 0}
                isLatestLeafScreen={isLatestLeafScreen}
                previousImageUrl={prevImageUrl}
                isStreaming={isLatestLeafScreen && isStreaming}
                showActions={index === state.cursorIndex}
                isImagePending={isImagePending}
                showActionLabelAsCard={isLatestLeafScreen && showActionLabelAsCard}
                streamFailed={isLatestLeafScreen && state.streamFailed}
                onRetry={handleRetry}
                onGenerateImage={handleGenerateImage}
                onImageLoaded={imageLoaded}
                onActionSelect={handleActionSelect}
                onGoBack={handleGoBack}
                onRedo={handleRedo}
                onGoForward={handleGoForward}
                onStartOver={chat.userWorld ? handleStartOver : undefined}
                messageCount={
                  index > 0 && isLatestLeafScreen && messageCount !== null
                    ? messageCount
                    : 0
                }
                accessType={chat.accessType}
                characterNames={topCharacters}
              />
            </section>
          );
        })}
      </Container>
    </div>
  );
}

function CenteredLoader() {
  return (
    <div className="flex h-svh w-full items-center justify-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}
