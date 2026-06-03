import { IconCheck } from '@tabler/icons-react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';

import { AnimatedActionCards } from '@/components/chat/actions';
import { ImageLoader } from '@/components/chat/image-loader';
import { ClickableImage } from '@/components/chat/image-modal';
import { Markdown } from '@/components/chat/markdown';
import {
  type ChatChildNode,
  type ChatLeafNode,
  type NodePart
} from '@/components/chat/state-machine';
import { Button } from '@/components/ui/button';
import { useImageLoaded } from '@/hooks/use-image-loaded';
import { transformImageUrl } from '@/lib/media/transform-url';

import { Separator } from '../ui/separator';
import { SaveProgressAlert } from './save-progress-alert';

export function ChatNodeScreen({
  node,
  nodeIndex,
  cursorIndex,
  isFirstNode,
  isLatestLeafScreen,
  previousImageUrl,
  isStreaming,
  showActions,
  isImagePending,
  showActionLabelAsCard,
  streamFailed,
  onRetry,
  onGenerateImage,
  onImageLoaded,
  onActionSelect,
  onGoBack,
  onRedo,
  onGoForward,
  messageCount,
  accessType,
  characterNames
}: {
  node: ChatLeafNode;
  nodeIndex: number;
  cursorIndex: number;
  isFirstNode: boolean;
  isLatestLeafScreen: boolean;
  previousImageUrl: string | null;
  isStreaming: boolean;
  showActions: boolean;
  isImagePending: boolean;
  showActionLabelAsCard?: boolean;
  streamFailed?: boolean;
  onRetry?: () => void;
  characterNames: string[];
  onGenerateImage: (chatMessagePartId: string) => void;
  onImageLoaded: (partId: string) => void;
  onActionSelect: (args: {
    content: string;
    parentNodeId: string;
    parentIndex: number;
  }) => void;
  onGoBack: (fromIndex: number) => void;
  onRedo: (toIndex: number) => void;
  onGoForward: (fromIndex: number, child: ChatChildNode) => void;
  onStartOver?: () => void;
  messageCount: number;
  accessType: 'public' | 'demo' | 'preview' | null;
}) {
  const contentParts = node.parts.filter((part) => part.type === 'CONTENT') ?? [];
  const actionParts = node.parts.filter((part) => part.type === 'ACTION') ?? [];
  const visualParts = node.parts.filter((part) => part.type === 'VISUAL') ?? [];
  const imagePart = visualParts.find((part) => part.subtype === 'image');
  const children = node.children ?? [];

  const imageUrl = imagePart?.contentUrl
    ? transformImageUrl(imagePart.contentUrl, { variant: 'thumb' })
    : null;

  const imageLoaded = useImageLoaded(isImagePending && imageUrl ? imageUrl : null);

  useEffect(() => {
    if (isImagePending && imageLoaded && imagePart) {
      onImageLoaded(imagePart.id);
    }
  }, [isImagePending, imageLoaded, imagePart, onImageLoaded]);

  const showImage = imageUrl && (!isImagePending || imageLoaded);

  const takenChildByActionLabel = new Map<string, ChatChildNode>();
  for (const child of children) takenChildByActionLabel.set(child.actionLabel, child);

  const actionLabels = new Set(actionParts.map((a) => a.content));
  const customTakenChildren = children.filter((c) => !actionLabels.has(c.actionLabel));
  const showContentSkeleton = contentParts.length === 0 && isLatestLeafScreen;

  const isAtCursor = nodeIndex === cursorIndex;
  const isAheadOfCursor = nodeIndex > cursorIndex;

  return (
    <>
      {node.actionLabel &&
        !isFirstNode &&
        (showActionLabelAsCard ? (
          <div className="px-4 py-3">
            <div className="rounded-lg border border-gray-300 bg-gray-100 p-4 shadow-[inset_0_0_5px_rgba(0,0,0,0.1)]">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm">
                  <div className="mb-1 text-xs tracking-wide text-gray-600 uppercase">
                    Your pending fate
                  </div>
                  <div className="line-clamp-1 font-semibold text-gray-900">
                    {node.actionLabel}
                  </div>
                </div>
                <span className="flex min-w-23 shrink-0 items-center justify-center gap-1.5 rounded-lg border-2 border-primary bg-background px-3.5 py-1.5 text-center text-sm font-medium text-primary shadow-[inset_0_1px_0_var(--color-neutral-300),0_10px_15px_-3px_rgb(0_0_0/0.1),0_4px_6px_-4px_rgb(0_0_0/0.1)]">
                  <IconCheck className="size-4" />
                  Selected
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={clsx(
              'flex items-end justify-between px-4 py-3',
              isLatestLeafScreen && 'animate-fade-in-delayed h-24.25'
            )}
          >
            <span className="line-clamp-1 grow text-sm text-muted-foreground italic">
              {node.actionLabel}
            </span>

            {isAtCursor && !isStreaming ? (
              <button
                onClick={() => onGoBack(nodeIndex)}
                className="text-sm font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Undo
              </button>
            ) : isAheadOfCursor ? (
              <button
                onClick={() => onRedo(nodeIndex)}
                className="text-sm font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Redo
              </button>
            ) : null}
          </div>
        ))}

      {!imagePart && !(isStreaming && node.shouldGenerateVisual) ? <Separator /> : null}

      {showImage && (
        <div className="overflow-hidden">
          <ClickableImage
            src={imageUrl}
            largeSrc={transformImageUrl(imagePart!.contentUrl!)}
            alt=""
            className="aspect-video w-full object-cover shadow-lg"
            loading={isLatestLeafScreen ? 'eager' : 'lazy'}
          />
        </div>
      )}

      <AnimatePresence custom={showImage}>
        {!showImage && (imagePart || (isStreaming && node.shouldGenerateVisual)) && (
          <motion.div
            key="visual-loader"
            variants={{
              exit: (replacedByImage: boolean) =>
                replacedByImage
                  ? { transition: { duration: 0 } }
                  : {
                      height: 0,
                      opacity: 0,
                      transition: { duration: 0.3, ease: 'easeInOut' }
                    }
            }}
            exit="exit"
            style={{ overflow: 'hidden' }}
          >
            <ChatNodeVisualLoader
              visualPartId={imagePart?.id}
              isImagePending={isImagePending}
              previousImageUrl={previousImageUrl}
              onGenerateImage={onGenerateImage}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={clsx(
          'p-4',
          isLatestLeafScreen && contentParts.length === 0 ? 'min-h-56' : ''
        )}
      >
        {showContentSkeleton ? (
          <AssistantMessageComponent
            part={{ id: 'skeleton', type: 'CONTENT', content: '' }}
            isFirstNode={isFirstNode}
            isStreaming={true}
          />
        ) : (
          contentParts.map((part, index) => (
            <AssistantMessageComponent
              key={part.id}
              part={part}
              isFirstNode={isFirstNode}
              isStreaming={isStreaming && index === contentParts.length - 1}
            />
          ))
        )}
      </div>

      {streamFailed && !isStreaming && (
        <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">
            Something went wrong generating the response. Please try again.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {showActions && !streamFailed && (
        <div className="flex flex-col gap-3 pt-4">
          {(actionParts.length > 0 || customTakenChildren.length > 0) && (
            <AnimatedActionCards
              actions={[
                ...actionParts.map((action) => {
                  const takenChild = takenChildByActionLabel.get(action.content) ?? null;
                  return {
                    id: action.id,
                    title: action.content,
                    description: null,
                    childNodeId: takenChild?.id,
                    taken: !!takenChild
                  };
                }),
                ...customTakenChildren.map((child) => ({
                  id: child.id,
                  title: child.actionLabel,
                  description: null,
                  childNodeId: child.id,
                  taken: true
                }))
              ]}
              parentNodeId={node.id}
              onSelect={(content) => {
                onActionSelect({
                  content,
                  parentNodeId: node.id,
                  parentIndex: nodeIndex
                });
              }}
              onGoForward={(childNodeId) => {
                const child = children.find((c) => c.id === childNodeId);
                if (child) onGoForward(nodeIndex, child);
              }}
              disabled={!node || isStreaming}
              showWriteYourOwn={actionParts.length > 0}
              characterNames={characterNames}
            />
          )}
          {messageCount > 0 && !isStreaming && (
            <div className="px-2 md:px-0">
              <SaveProgressAlert
                messageCount={messageCount}
                accessType={accessType}
                characterName={characterNames[0]}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function AssistantMessageComponent({
  part,
  isFirstNode,
  isStreaming
}: {
  part: NodePart;
  isFirstNode: boolean;
  isStreaming: boolean;
}) {
  const baseContent = part.content || ' ';
  const streamingContent = baseContent.replace(/[\r\n]+$/, '') || ' ';
  const displayContent = isStreaming ? streamingContent + ':::loader:::' : baseContent;

  return (
    <Markdown
      className={clsx(
        'prose wrap-break-words p-0 font-serif text-base leading-relaxed tracking-normal whitespace-normal text-foreground/95 [&_p]:my-3',
        isFirstNode &&
          '[&_p:first-of-type]:first-letter:float-left [&_p:first-of-type]:first-letter:-mt-0.5 [&_p:first-of-type]:first-letter:mr-3 [&_p:first-of-type]:first-letter:font-serif [&_p:first-of-type]:first-letter:text-[60px] [&_p:first-of-type]:first-letter:leading-[0.8] [&_p:first-of-type]:first-letter:text-foreground [&_p:first-of-type]:first-letter:uppercase [&_p:first-of-type]:first-letter:drop-shadow-sm'
      )}
    >
      {displayContent}
    </Markdown>
  );
}

function ChatNodeVisualLoader({
  visualPartId,
  isImagePending,
  onGenerateImage,
  previousImageUrl
}: {
  visualPartId?: string;
  isImagePending: boolean;
  onGenerateImage: (visualPartId: string) => void;
  previousImageUrl: string | null;
}) {
  const showGenerateButton = visualPartId && !isImagePending;

  return showGenerateButton ? (
    <div className="flex aspect-video w-full items-center justify-center bg-gray-100">
      <Button size="xl" onClick={() => onGenerateImage(visualPartId)}>
        Generate Image
      </Button>
    </div>
  ) : (
    <ImageLoader previousImageUrl={previousImageUrl} />
  );
}
