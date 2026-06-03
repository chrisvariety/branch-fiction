import { IconCheck, IconCornerDownRight } from '@tabler/icons-react';
import { useMutationState } from '@tanstack/react-query';
import clsx from 'clsx';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import {
  AutocompleteTextarea,
  type AutocompleteTextareaRef
} from '../autocomplete-textbox/autocomplete-textarea';

function usePendingAction() {
  const performActionState = useMutationState({
    filters: { mutationKey: ['performAction'], status: 'pending' },
    select: (mutation) =>
      mutation.state.variables as
        | {
            content: string;
            parentNodeId: string;
            parentIndex: number;
          }
        | undefined
  });
  const loadNodeState = useMutationState({
    filters: { mutationKey: ['loadNode'], status: 'pending' },
    select: (mutation) =>
      mutation.state.variables as
        | {
            nodeId: string;
            parentIndex: number;
          }
        | undefined
  });
  return {
    performAction: performActionState[0] ?? null,
    loadNode: loadNodeState[0] ?? null
  };
}

const containerClassName =
  'rounded-lg border border-gray-300 p-4 shadow-[0_0_15px_rgba(0,0,0,0.1)] w-full';

const cardClassName = `group flex h-full cursor-pointer flex-col gap-3 text-left transition-colors disabled:cursor-default disabled:opacity-50 ${containerClassName}`;

function ActionCardContent({
  title,
  description,
  actionLabel,
  taken
}: {
  title: string;
  description: string | null;
  actionLabel: string;
  taken?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-gray-900">{title}</div>
        {description && <div className="mt-1 text-sm text-gray-700">{description}</div>}
      </div>
      <span
        className={clsx(
          'flex min-w-23 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-center text-sm font-medium transition-colors',
          taken
            ? 'border-2 border-primary bg-background text-primary shadow-[inset_0_1px_0_var(--color-neutral-300),0_10px_15px_-3px_rgb(0_0_0/0.1),0_4px_6px_-4px_rgb(0_0_0/0.1)]'
            : 'border-zinc-950 bg-neutral-800 text-white shadow-[inset_0_1px_0_var(--color-neutral-700),0_10px_15px_-3px_rgb(0_0_0/0.1),0_4px_6px_-4px_rgb(0_0_0/0.1)] group-hover:bg-neutral-700'
        )}
      >
        {taken && <IconCheck className="size-4" />}
        {actionLabel}
      </span>
    </div>
  );
}

export function ActionCard({
  action,
  parentNodeId,
  childNodeId,
  onSelect,
  disabled,
  taken
}: {
  action: {
    id: string;
    title: string;
    description: string | null;
  };
  parentNodeId: string;
  childNodeId?: string;
  onSelect: (actionId: string) => void;
  disabled?: boolean;
  taken?: boolean;
}) {
  const { performAction, loadNode } = usePendingAction();
  const isPerformingAction =
    performAction?.content === action.title &&
    performAction?.parentNodeId === parentNodeId;
  const isLoadingNode = childNodeId != null && loadNode?.nodeId === childNodeId;
  const isPending = isPerformingAction || isLoadingNode;
  const isBusy = !!performAction || !!loadNode;
  const actionLabel = isPending ? 'Loading…' : taken ? 'Selected' : 'Select';

  return (
    <button
      type="button"
      disabled={disabled || isBusy}
      onClick={() => onSelect(action.id)}
      className={clsx(
        cardClassName,
        taken
          ? 'bg-gray-100 shadow-[inset_0_0_5px_rgba(0,0,0,0.1)]'
          : 'bg-white hover:bg-gray-50'
      )}
    >
      <ActionCardContent
        title={action.title}
        description={action.description}
        actionLabel={actionLabel}
        taken={taken}
      />
    </button>
  );
}

export function WriteYourOwnActionCard({
  onSubmit,
  disabled,
  characterNames,
  actionTitles
}: {
  onSubmit: (content: string) => void;
  disabled?: boolean;
  characterNames: string[];
  actionTitles: string[];
}) {
  const { performAction, loadNode } = usePendingAction();
  const isPerformingAction = !!performAction || !!loadNode;
  const [isExpanded, setIsExpanded] = useState(false);
  const [content, setContent] = useState('');
  const textareaRef = useRef<AutocompleteTextareaRef>(null);
  const isDisabled = disabled || isPerformingAction;

  const handleSubmit = () => {
    if (!content.trim()) return;
    onSubmit(content.trim());
    setContent('');
    setIsExpanded(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setIsExpanded(false);
      setContent('');
    }
  };

  if (isExpanded) {
    return (
      <div className="px-2 md:px-0">
        <div className={containerClassName}>
          <AutocompleteTextarea
            ref={textareaRef}
            value={content}
            onChange={setContent}
            onKeyDown={handleKeyDown}
            placeholder="Write your own action..."
            className="w-full resize-none bg-transparent text-base text-gray-900 placeholder:text-gray-500 focus:outline-none"
            suggestions={characterNames}
            minRows={2}
            maxRows={6}
            autoFocus
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => {
                setIsExpanded(false);
                setContent('');
              }}
              className="px-3 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!content.trim()}
              className="rounded-lg border border-zinc-950 bg-neutral-800 px-3.5 py-1.5 text-sm font-medium text-white shadow-[inset_0_1px_0_var(--color-neutral-700),0_10px_15px_-3px_rgb(0_0_0/0.1),0_4px_6px_-4px_rgb(0_0_0/0.1)] transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Submit
            </button>
          </div>
          {actionTitles.length > 0 && (
            <div className="mt-3 border-t border-gray-200 pt-3">
              <div className="mb-2 text-xs font-medium text-gray-500">
                Put your own spin on…
              </div>
              <div className="flex flex-col gap-1">
                {actionTitles.map((title) => (
                  <button
                    key={title}
                    type="button"
                    onClick={() => {
                      setContent(title);
                      requestAnimationFrame(() => {
                        textareaRef.current?.focus();
                      });
                    }}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    <IconCornerDownRight className="size-3.5 shrink-0 text-gray-400" />
                    <span className="line-clamp-1">{title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-2 md:px-0">
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => setIsExpanded(true)}
        className={cardClassName}
      >
        <ActionCardContent
          title="Write your own..."
          description={null}
          actionLabel="Write"
        />
      </button>
    </div>
  );
}

const FADE_DURATION = 0.3;

type ActionItem = {
  id: string;
  title: string;
  description: string | null;
  childNodeId?: string;
  taken?: boolean;
};

export function AnimatedActionCards({
  actions,
  parentNodeId,
  onSelect,
  onGoForward,
  disabled,
  showWriteYourOwn,
  characterNames
}: {
  actions: ActionItem[];
  parentNodeId: string;
  onSelect: (actionTitle: string) => void;
  onGoForward?: (childNodeId: string) => void;
  disabled?: boolean;
  showWriteYourOwn?: boolean;
  characterNames: string[];
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const { performAction, loadNode } = usePendingAction();
  const isBusy = !!performAction || !!loadNode;

  // Reset selection if mutation finished (error or unmounted node)
  useEffect(() => {
    if (!isBusy && selectedIndex !== null) {
      // eslint-disable-next-line
      setSelectedIndex(null);
    }
  }, [isBusy, selectedIndex]);

  const handleSelect = (index: number, action: ActionItem) => {
    if (action.childNodeId && onGoForward) {
      onGoForward(action.childNodeId);
      return;
    }

    setSelectedIndex(index);
    onSelect(action.title);
  };

  const handleWriteYourOwn = (content: string) => {
    setSelectedIndex(actions.length);
    onSelect(content);
  };

  return (
    <motion.div
      className="flex flex-col gap-3"
      animate={selectedIndex !== null ? { opacity: 0 } : { opacity: 1 }}
      transition={{ duration: FADE_DURATION, ease: 'easeOut' }}
    >
      {actions.map((action, index) => (
        <div className="px-2 md:px-0" key={action.id}>
          <ActionCard
            action={{
              id: action.id,
              title: action.title,
              description: action.description
            }}
            parentNodeId={parentNodeId}
            childNodeId={action.childNodeId}
            onSelect={() => handleSelect(index, action)}
            disabled={disabled || isBusy || selectedIndex !== null}
            taken={selectedIndex === index ? true : action.taken}
          />
        </div>
      ))}

      {showWriteYourOwn && (
        <WriteYourOwnActionCard
          onSubmit={handleWriteYourOwn}
          disabled={disabled || isBusy || selectedIndex !== null}
          characterNames={characterNames}
          actionTitles={actions.map((a) => a.title)}
        />
      )}
    </motion.div>
  );
}
