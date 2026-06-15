import { useRender } from '@base-ui/react/use-render';
import { IconChevronLeft, IconPencil } from '@tabler/icons-react';
import { useMutation, useMutationState, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import clsx from 'clsx';
import { Suspense, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Container, HeaderContainer } from '@/components/chat/container';
import { ImageLoader } from '@/components/chat/image-loader';
import { ClickableImage } from '@/components/chat/image-modal';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { worldQueryOptions } from '@/hooks/queries/world-data';
import { updateUserWorldTitleById } from '@/iframe/db/models/user-world/update-user-world';

import { createNewChat, generateScenarios, generateWorldImage } from '../book/data';

type BookCtx = ExtensionCtx & { bookId: string };

type Props = {
  ctx: BookCtx;
  worldSlug: string;
};

export function World({ worldSlug }: Props) {
  return (
    <Suspense fallback={<CenteredLoader />}>
      <WorldInner worldSlug={worldSlug} />
    </Suspense>
  );
}

function WorldInner({ worldSlug }: { worldSlug: string }) {
  const { data: world, refetch } = useSuspenseQuery(worldQueryOptions(worldSlug));
  const [isEditing, setIsEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(world.title);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [userPrompt, setUserPrompt] = useState('');
  const [showPromptInput, setShowPromptInput] = useState(false);

  const { mutate: triggerImageGeneration } = useMutation({
    mutationKey: ['generateWorldImage'],
    gcTime: Infinity,
    mutationFn: (userWorldId: string) => generateWorldImage({ userWorldId }),
    onSuccess: async () => {
      await refetch();
    },
    onError: (error) => {
      toast.error('Failed to generate image', {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  });

  const router = useRouter();
  const { mutate: regenerateScenarios, isPending: isRegenerating } = useMutation({
    mutationKey: ['regenerateScenarios'],
    mutationFn: async (prompt: string) => {
      await generateScenarios({
        userWorldId: world.id,
        prompt: prompt || undefined
      });
    },
    onSuccess: () => {
      void refetch();
      void router.invalidate();
    },
    onError: (error) => {
      toast.error('Failed to generate scenarios', {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  });

  const imageGenerationState = useMutationState({
    filters: {
      mutationKey: ['generateWorldImage'],
      predicate: (mutation) =>
        (mutation.state.variables as string | undefined) === world.id
    },
    select: (mutation) => ({ status: mutation.state.status })
  });
  const currentImageState = imageGenerationState[imageGenerationState.length - 1];
  const isGeneratingImage = currentImageState?.status === 'pending';

  // Pick up completion of a background generation kicked off from InteractivePicker.
  const prevImageStatus = useRef(currentImageState?.status);
  useEffect(() => {
    if (
      prevImageStatus.current === 'pending' &&
      currentImageState?.status === 'success'
    ) {
      void refetch();
    }
    prevImageStatus.current = currentImageState?.status;
  }, [currentImageState?.status, refetch]);

  const handleUpdate = async () => {
    const next = titleDraft.trim();
    if (!next || next === world.title) {
      setIsEditing(false);
      setTitleDraft(world.title);
      return;
    }
    setIsSavingTitle(true);
    try {
      await updateUserWorldTitleById(world.id, next);
      await refetch();
      setIsEditing(false);
    } catch (e) {
      console.error('Failed to update title:', e);
    } finally {
      setIsSavingTitle(false);
    }
  };

  return (
    <Container className="lg:max-w-4xl">
      <HeaderContainer>
        <div className="flex w-full items-center">
          <div className="w-12 shrink-0">
            <Link
              to="/"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-lg hover:text-foreground"
            >
              <IconChevronLeft className="h-6 w-6" />
            </Link>
          </div>
          {isEditing ? (
            <div className="mr-4 ml-2 flex flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleUpdate();
                  if (e.key === 'Escape') {
                    setIsEditing(false);
                    setTitleDraft(world.title);
                  }
                }}
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              <Button
                size="sm"
                variant="primary"
                onClick={handleUpdate}
                disabled={isSavingTitle}
              >
                {isSavingTitle ? 'Updating…' : 'Update'}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="mx-2 flex min-w-0 flex-1 items-center justify-center gap-2 font-sans text-base font-medium"
              onClick={() => setIsEditing(true)}
            >
              <span className="truncate">{world.title}</span>
              <IconPencil className="size-4 shrink-0 text-muted-foreground" />
            </button>
          )}
        </div>
      </HeaderContainer>

      <div className="relative mx-4 overflow-hidden rounded-xl">
        {world.imageUrl ? (
          <ClickableImage
            src={world.imageUrl}
            largeSrc={world.largeImageUrl ?? undefined}
            alt={world.title}
            className="w-full object-cover"
          />
        ) : isGeneratingImage ? (
          <ImageLoader />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-muted">
            <Button size="xl" onClick={() => triggerImageGeneration(world.id)}>
              Generate Image
            </Button>
          </div>
        )}
      </div>

      <div className="px-4 py-5">
        <h2 className="font-sans font-medium md:text-lg">
          You've set the stage. Now, what if…
        </h2>
      </div>
      <div className="px-4 pb-4">
        <ScenarioList scenarios={world.scenarios} worldSlug={worldSlug} />
      </div>
      <div className="px-4 pb-5">
        {showPromptInput ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
            <input
              type="text"
              placeholder="e.g. What if Nick never left?"
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && userPrompt.trim()) {
                  regenerateScenarios(userPrompt.trim());
                }
              }}
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <Button
              size="sm"
              variant="primary"
              onClick={() => regenerateScenarios(userPrompt.trim())}
              disabled={isRegenerating}
            >
              {isRegenerating ? 'Generating…' : 'Generate'}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setShowPromptInput(true)}>
            Generate additional scenarios
          </Button>
        )}
      </div>
    </Container>
  );
}

function ScenarioList({
  scenarios,
  worldSlug
}: {
  scenarios: {
    id: string;
    title: string;
    description: string;
    toneTags: string[];
    chatSlug?: string;
  }[];
  worldSlug: string;
}) {
  const navigate = useNavigate();

  const { mutate: selectScenario } = useMutation({
    mutationKey: ['createChat'],
    mutationFn: async (scenarioId: string) => {
      let wakeLock: WakeLockSentinel | null = null;
      try {
        if ('wakeLock' in navigator) {
          try {
            wakeLock = await navigator.wakeLock.request('screen');
          } catch {
            // Wake lock may be blocked by Permissions-Policy; non-fatal.
          }
        }
        const { chatSlug } = await createNewChat({
          scenarioId,
          userWorldSlug: worldSlug
        });
        return chatSlug;
      } finally {
        if (wakeLock) {
          await wakeLock.release();
        }
      }
    },
    onSuccess: (chatSlug) => {
      void navigate({ to: '/chat/$chatSlug', params: { chatSlug } });
    },
    onError: (error) => {
      console.error('Failed to create chat:', error);
      toast.error('Failed to start chat', {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  });

  const createChatMutations = useMutationState({
    filters: { mutationKey: ['createChat'] },
    select: (mutation) => ({
      scenarioId: mutation.state.variables as string,
      status: mutation.state.status
    })
  });

  if (scenarios.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {scenarios.map((scenario) => {
        if (scenario.chatSlug) {
          return (
            <ScenarioCard
              key={scenario.id}
              render={
                <Link to="/chat/$chatSlug" params={{ chatSlug: scenario.chatSlug }} />
              }
              title={scenario.title}
              description={scenario.description}
              toneTags={scenario.toneTags}
              isContinuing
            />
          );
        }
        const isPending = createChatMutations.some(
          (m) => m.scenarioId === scenario.id && m.status === 'pending'
        );
        return (
          <ScenarioCard
            key={scenario.id}
            title={scenario.title}
            description={scenario.description}
            toneTags={scenario.toneTags}
            onClick={() => selectScenario(scenario.id)}
            disabled={createChatMutations.some((m) => m.status === 'pending')}
            isPending={isPending}
          />
        );
      })}
    </div>
  );
}

function ScenarioCard({
  title,
  description,
  toneTags,
  isPending,
  isContinuing,
  render = <button type="button" />,
  ...props
}: {
  title: string;
  description: string | null;
  toneTags?: string[];
  isPending?: boolean;
  isContinuing?: boolean;
  render?: React.ReactElement;
} & React.ComponentPropsWithoutRef<'button'>) {
  return useRender({
    render,
    props: {
      ...props,
      className: clsx(
        'group block w-full cursor-pointer rounded-lg border border-border px-5 py-4 text-left shadow-[0_0_15px_rgba(0,0,0,0.1)] transition-colors disabled:cursor-default disabled:opacity-50',
        isContinuing
          ? 'bg-muted shadow-[inset_0_0_5px_rgba(0,0,0,0.1)]'
          : 'bg-background hover:bg-muted/60'
      ),
      children: (
        <div className="flex w-full flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{title}</div>
              {description && (
                <div className="mt-1 text-sm font-light text-muted-foreground">
                  {description}
                </div>
              )}
            </div>
            {isContinuing && (
              <div className="shrink-0 text-xs font-medium text-muted-foreground uppercase">
                In Progress
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            {toneTags && toneTags.length > 0 ? (
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {toneTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <div />
            )}
            <span
              className={clsx(
                'flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors',
                isContinuing
                  ? 'border-2 border-primary bg-background text-primary'
                  : 'border-zinc-950 bg-neutral-800 text-white group-hover:bg-neutral-700',
                isPending && 'animate-pulse'
              )}
            >
              {isContinuing ? 'Continue' : 'Enter'}
            </span>
          </div>
        </div>
      )
    }
  });
}

function CenteredLoader() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}
