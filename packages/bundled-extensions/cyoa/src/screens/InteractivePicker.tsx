import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import { IconArrowLeft, IconArrowRight } from '@tabler/icons-react';
import { useMutation, useMutationState, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  InteractiveCarousel,
  type InteractiveCarouselItem
} from '@/components/interactive/carousel';
import { ConfigureModal } from '@/components/interactive/configure-modal';
import { FirstCharacterToast } from '@/components/interactive/first-character-toast';
import { InteractiveHeader } from '@/components/interactive/header';
import { WorldBuildingLoadingOverlay } from '@/components/interactive/loading-overlay';
import { InteractiveModal } from '@/components/interactive/modal';
import { useOrderedCarouselItems } from '@/components/interactive/order-entities';
import { InteractivePanel } from '@/components/interactive/panel';
import { SimpleEntityGrid } from '@/components/interactive/simple-grid';
import { MAX_CHARACTER_SELECTIONS } from '@/components/interactive/state-machine';
import { getInteractivePanel } from '@/components/interactive/step';
import {
  useInteractiveState,
  type EffectIntent
} from '@/components/interactive/use-interactive-state';
import { WelcomeDialog } from '@/components/interactive/welcome-dialog';
import {
  useZoom,
  ZoomedOverlay,
  ZoomedOverlayContent
} from '@/components/interactive/zoom';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { bookDataQueryOptions } from '@/hooks/queries/book-data';

import { buildWorld, generateScenarios, generateWorldImage } from '../book/data';

type Props = { ctx: ExtensionCtx & { bookId: string } };

export function InteractivePicker({ ctx }: Props) {
  const bookId = ctx.bookId;
  const navigate = useNavigate();

  const { data } = useSuspenseQuery(bookDataQueryOptions(bookId));
  const { characterInteractive, placeInteractive, book, characterPlaceScores } = data;

  const initialCarouselItemId = characterInteractive.bookInteractiveEntities[0]?.id ?? '';

  const {
    state,
    dispatch: baseDispatch,
    canGoBack,
    canGoNext,
    primaryCta,
    toggleCharacterSelection: baseToggleCharacter,
    togglePlaceSelection: baseTogglePlace
  } = useInteractiveState({
    initialCarouselItemId
  });

  const { mutate: generateWorldImageAsync } = useMutation({
    mutationKey: ['generateWorldImage'],
    gcTime: Infinity,
    mutationFn: (userWorldId: string) => generateWorldImage({ userWorldId })
  });

  const { mutate: buildWorldAsync } = useMutation({
    mutationKey: ['buildWorld'],
    mutationFn: async () => {
      let wakeLock: WakeLockSentinel | null = null;

      try {
        if ('wakeLock' in navigator) {
          try {
            wakeLock = await navigator.wakeLock.request('screen');
          } catch {
            // Wake lock may be blocked by Permissions-Policy; non-fatal.
          }
        }

        const bookInteractiveEntities = [
          ...state.selectedCharacters.map((char) => char.id),
          ...(state.selectedPlace ? [state.selectedPlace.id] : [])
        ];

        const { worldSlug, userWorldId, reused } = await buildWorld({
          bookId: book.id,
          bookInteractiveEntities
        });

        if (!reused) {
          generateWorldImageAsync(userWorldId);
          await generateScenarios({ userWorldId });
        }

        return worldSlug;
      } finally {
        if (wakeLock) {
          await wakeLock.release();
        }
      }
    },
    onSuccess: (worldSlug) => {
      void navigate({ to: '/world/$worldSlug', params: { worldSlug } });
    },
    onError: (error) => {
      console.error('Failed to build world:', error);
      toast.error('Failed to build world', {
        description: error instanceof Error ? error.message : String(error)
      });
    },
    retry: false
  });

  const buildWorldStatuses = useMutationState({
    filters: { mutationKey: ['buildWorld'] },
    select: (mutation) => mutation.state.status
  });
  const isEnteringWorld = buildWorldStatuses.some((status) => status === 'pending');
  const showLoadingOverlay = isEnteringWorld;

  const {
    currentStep,
    selectedCharacters,
    selectedPlace,
    showPlayingAsToast,
    pendingPlayerChange,
    showMaxSelectionError,
    showWelcome,
    activeCoachmark,
    activeCarouselItemId,
    suggestedCharacterId,
    playerCharacterId
  } = state;

  const interactivePanel = getInteractivePanel(currentStep);

  const activeInteractive =
    interactivePanel === 'characters' ? characterInteractive : placeInteractive;

  const characterIsSimple = !characterInteractive.url;
  const placeIsSimple = !placeInteractive.url;
  const activeIsSimple =
    interactivePanel === 'characters' ? characterIsSimple : placeIsSimple;
  const bothRich = !characterIsSimple && !placeIsSimple;

  const {
    viewportRef,
    frameRef,
    zoom,
    zoomContentStyle,
    isInteracting,
    handlePolygonClick,
    resetZoom,
    scheduleAutoZoom
  } = useZoom({
    interactiveWidth: activeInteractive.width ?? 0,
    interactiveHeight: activeInteractive.height ?? 0,
    entities: activeInteractive.bookInteractiveEntities,
    activeEntityId: activeCarouselItemId,
    onActiveChange: (interactiveEntityId) => {
      dispatch({
        type: 'SET_ACTIVE_CAROUSEL_ITEM',
        itemId: interactiveEntityId,
        source: 'polygon'
      });
    }
  });

  const bottomBarRef = useRef<HTMLDivElement | null>(null);

  const executeEffects = (effects: EffectIntent[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'RESET_ZOOM':
          resetZoom();
          break;
        case 'ZOOM_TO_PLACE': {
          const placeEntity = placeInteractive.bookInteractiveEntities.find(
            (e) => e.id === effect.placeId
          );
          if (placeEntity?.clickArea) {
            scheduleAutoZoom(
              placeEntity.id,
              placeEntity.clickArea,
              placeEntity.headArea,
              0
            );
          }
          break;
        }
        case 'ENTER_WORLD':
          buildWorldAsync();
          break;
        case 'FOCUS_BOTTOM_BAR': {
          const target = bottomBarRef.current;
          if (!target) break;
          requestAnimationFrame(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'end' });
          });
          break;
        }
      }
    }
  };

  const dispatch: typeof baseDispatch = (action) => {
    let effects = baseDispatch(action);
    if (
      currentStep === 'selectCharacters' &&
      action.type === 'SET_ACTIVE_CAROUSEL_ITEM' &&
      action.source === 'carousel'
    ) {
      effects = effects.filter((e) => e.type !== 'RESET_ZOOM');
    }
    executeEffects(effects);
    return effects;
  };
  const toggleCharacterSelection: typeof baseToggleCharacter = (char) => {
    const effects = baseToggleCharacter(char);
    executeEffects(effects);
    return effects;
  };
  const togglePlaceSelection: typeof baseTogglePlace = (place) => {
    const effects = baseTogglePlace(place);
    executeEffects(effects);
    return effects;
  };

  const carouselItems = useOrderedCarouselItems({
    currentStep,
    characterEntities: characterInteractive.bookInteractiveEntities,
    placeEntities: placeInteractive.bookInteractiveEntities,
    selectedCharacters,
    characterPlaceScores
  });

  const carouselItemIdsKey = carouselItems.map((item) => item.id).join(',');
  const [prevCarouselItemIdsKey, setPrevCarouselItemIdsKey] =
    useState(carouselItemIdsKey);
  if (prevCarouselItemIdsKey !== carouselItemIdsKey) {
    setPrevCarouselItemIdsKey(carouselItemIdsKey);
    const ids = carouselItemIdsKey.split(',').filter(Boolean);
    if (ids.length > 0 && !ids.includes(activeCarouselItemId)) {
      dispatch({
        type: 'RESET_CAROUSEL_TO_FIRST',
        firstItemId: carouselItems[0]?.id ?? ''
      });
    }
  }

  const [richImageLoaded, setRichImageLoaded] = useState(false);
  // Defer the simple grid one frame so it can fade in (mirrors how the rich
  // viewport stays opacity-0 until the scene image's onLoad fires).
  const [simpleReady, setSimpleReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setSimpleReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const imageLoaded = activeIsSimple ? simpleReady : richImageLoaded;
  const [showConfigure, setShowConfigure] = useState(false);

  const selectedCharacterIds = new Set(selectedCharacters.map((c) => c.id));
  const selectedPlaceIds = selectedPlace
    ? new Set([selectedPlace.id])
    : new Set<string>();

  const suggestedEntity = suggestedCharacterId
    ? characterInteractive.bookInteractiveEntities.find(
        (e) => e.id === suggestedCharacterId
      )
    : undefined;
  const suggestedCoachmarkLabel = suggestedEntity?.bookEntity
    ? `Maybe ${suggestedEntity.bookEntity.name}?`
    : undefined;

  const handleCarouselActiveChange = (newActiveId: string) => {
    dispatch({
      type: 'SET_ACTIVE_CAROUSEL_ITEM',
      itemId: newActiveId,
      source: 'carousel'
    });
    if (currentStep === 'selectCharacters') {
      const entity = characterInteractive.bookInteractiveEntities.find(
        (e) => e.id === newActiveId
      );
      if (entity?.clickArea) {
        scheduleAutoZoom(entity.id, entity.clickArea, entity.headArea, 0);
      }
    }
  };

  const handlePolygonClickSafe = (
    e: React.MouseEvent,
    entityId: string,
    clickArea: string,
    headArea: string | null
  ) => {
    if (isInteracting) return;
    handlePolygonClick(e, entityId, clickArea, headArea);
  };

  return (
    <div className="flex w-full items-start justify-center bg-background">
      <div className="relative w-auto max-w-full">
        {!imageLoaded && !activeIsSimple && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background">
            <Spinner className="size-8 text-foreground" />
            <p className="text-sm text-muted-foreground">Loading world…</p>
          </div>
        )}
        <InteractiveHeader
          hidden={!imageLoaded || isEnteringWorld || showWelcome}
          title={
            currentStep === 'selectCharacters'
              ? 'Character selection'
              : 'Location selection'
          }
          currentStep={currentStep}
          onPrevious={canGoBack ? () => dispatch({ type: 'GO_BACK' }) : undefined}
          onNext={canGoNext ? () => dispatch({ type: 'GO_NEXT' }) : undefined}
          onEdit={
            selectedCharacters.length > 0 ? () => setShowConfigure(true) : undefined
          }
        />

        <ConfigureModal
          open={showConfigure}
          onClose={() => {
            setShowConfigure(false);
            if (currentStep === 'selectPlace' && selectedCharacters.length === 0) {
              dispatch({ type: 'GO_TO_STEP', step: 'selectCharacters' });
            }
          }}
          selectedCharacters={selectedCharacters.map((c) => ({
            ...c,
            imageUrl: c.imageUrl ? transformImageUrl(c.imageUrl) : undefined
          }))}
          selectedPlace={
            selectedPlace
              ? {
                  ...selectedPlace,
                  imageUrl: selectedPlace.imageUrl
                    ? transformImageUrl(selectedPlace.imageUrl)
                    : undefined
                }
              : null
          }
          onRemoveCharacter={(characterId) =>
            dispatch({
              type: 'DESELECT_CHARACTER',
              characterId
            })
          }
          onChangeLocation={() => {
            setShowConfigure(false);
            resetZoom();
            if (currentStep !== 'selectPlace') {
              dispatch({ type: 'GO_TO_STEP', step: 'selectPlace' });
            }
          }}
          onAddCharacters={() => {
            setShowConfigure(false);
            resetZoom();
            if (currentStep !== 'selectCharacters') {
              dispatch({ type: 'GO_TO_STEP', step: 'selectCharacters' });
            }
          }}
          ctaLabel={
            primaryCta.intent === 'enter-world'
              ? 'Enter your world'
              : primaryCta.intent === 'proceed-to-place'
                ? 'Select location'
                : 'Select characters'
          }
          onCtaClick={() => {
            setShowConfigure(false);
            dispatch(primaryCta.action);
          }}
        />

        <div
          ref={viewportRef}
          className={clsx(
            'relative mt-8 overflow-hidden rounded-xl bg-foreground/5',
            'transition-opacity duration-300',
            !imageLoaded && 'opacity-0',
            activeIsSimple && 'h-[calc(100svh-2.5rem)] w-screen md:h-[calc(100vh-4rem)]'
          )}
          onClick={() => {
            if (zoom && zoom.scale !== 1) {
              dispatch({ type: 'CLICK_ZOOMED_OVERLAY' });
            }
          }}
        >
          {activeIsSimple ? (
            <div ref={frameRef} className="relative h-full w-full">
              <SimpleEntityGrid
                entities={activeInteractive.bookInteractiveEntities}
                selectedEntityIds={
                  interactivePanel === 'characters'
                    ? selectedCharacterIds
                    : selectedPlaceIds
                }
                playerEntityId={
                  interactivePanel === 'characters' ? playerCharacterId : null
                }
                onToggle={(item) => {
                  if (interactivePanel === 'characters') {
                    toggleCharacterSelection(item);
                  } else {
                    togglePlaceSelection(item);
                  }
                }}
                emptyLabel={
                  interactivePanel === 'characters'
                    ? 'No characters available'
                    : 'No locations available'
                }
              />
            </div>
          ) : (
            <div ref={frameRef} className="relative h-auto w-auto">
              <img
                src={transformImageUrl(activeInteractive.url!)}
                alt=""
                aria-hidden="true"
                className="pointer-events-none block h-auto max-h-[calc(100svh-2.5rem)] w-auto max-w-full object-contain opacity-0 md:max-h-[calc(100vh-4rem)]"
                draggable={false}
                ref={(el) => {
                  if (el?.complete) setRichImageLoaded(true);
                }}
                onLoad={() => setRichImageLoaded(true)}
              />
              <div className="absolute inset-0">
                <div
                  className={clsx(
                    'absolute inset-0 z-0 flex h-full overflow-hidden',
                    bothRich && 'w-[200%]',
                    bothRich &&
                      'transition-transform duration-700 ease-out motion-reduce:transition-none'
                  )}
                  style={
                    bothRich
                      ? {
                          transform:
                            interactivePanel === 'place'
                              ? 'translateX(-50%)'
                              : 'translateX(0%)'
                        }
                      : undefined
                  }
                >
                  {(
                    [
                      {
                        key: 'characters',
                        data: characterInteractive,
                        selectedEntityIds: selectedCharacterIds,
                        isSimple: characterIsSimple
                      },
                      {
                        key: 'place',
                        data: placeInteractive,
                        selectedEntityIds: selectedPlaceIds,
                        isSimple: placeIsSimple
                      }
                    ] as const
                  )
                    .filter(({ key, isSimple }) =>
                      // When a panel is SIMPLE we render it via SimpleEntityGrid
                      // above on its own step; only mount rich panels here, and
                      // when the other side is simple, only mount the active rich one.
                      bothRich ? !isSimple : key === interactivePanel && !isSimple
                    )
                    .map(({ key, data, selectedEntityIds }) => (
                      <InteractivePanel
                        key={key}
                        panelKey={key}
                        data={{
                          url: data.url!,
                          videoUrl: data.videoUrl,
                          width: data.width!,
                          height: data.height!,
                          bookInteractiveEntities: data.bookInteractiveEntities
                        }}
                        isActive={interactivePanel === key}
                        activeEntityId={activeCarouselItemId}
                        selectedEntityIds={selectedEntityIds}
                        isInteracting={isInteracting}
                        zoom={
                          interactivePanel === key && currentStep === 'selectPlace'
                            ? zoom
                            : null
                        }
                        hidePolygons={
                          key === 'place' &&
                          placeInteractive.bookInteractiveEntities.length <= 1
                        }
                        coachmarkLabel={
                          key === 'characters' ? suggestedCoachmarkLabel : undefined
                        }
                        onPolygonClick={handlePolygonClickSafe}
                      />
                    ))}
                </div>
                {currentStep === 'selectCharacters' && activeInteractive.url && (
                  <ZoomedOverlay
                    zoom={zoom}
                    zoomContentStyle={zoomContentStyle}
                    isInteracting={isInteracting}
                  >
                    <ZoomedOverlayContent
                      imageUrl={activeInteractive.url}
                      width={activeInteractive.width!}
                      height={activeInteractive.height!}
                      entities={activeInteractive.bookInteractiveEntities}
                      activeEntityId={activeCarouselItemId}
                      selectedEntityIds={selectedCharacterIds}
                      coachmarkLabel={suggestedCoachmarkLabel}
                      onPolygonClick={handlePolygonClickSafe}
                    />
                  </ZoomedOverlay>
                )}
              </div>
            </div>
          )}
          <div
            ref={bottomBarRef}
            className="absolute inset-x-0 bottom-2 z-10"
            hidden={!imageLoaded}
          >
            {showPlayingAsToast && selectedCharacters[0] && !characterIsSimple && (
              <div className="pointer-events-none mb-2 flex justify-center px-4">
                <FirstCharacterToast
                  character={selectedCharacters[0]}
                  onPickSomeoneElse={() =>
                    dispatch({
                      type: 'DESELECT_CHARACTER',
                      characterId: selectedCharacters[0].id
                    })
                  }
                  onAddCharacters={() => {
                    const currentIndex = carouselItems.findIndex(
                      (item) => item.id === state.activeCarouselItemId
                    );
                    let nextItem: (typeof carouselItems)[0] | undefined = undefined;
                    if (currentIndex > 0) {
                      nextItem = carouselItems.find(
                        (item, i) =>
                          i < currentIndex && !selectedCharacterIds.has(item.id)
                      );
                    }
                    if (!nextItem) {
                      nextItem =
                        carouselItems.find(
                          (item, i) =>
                            i > currentIndex && !selectedCharacterIds.has(item.id)
                        ) ??
                        carouselItems.find((item) => !selectedCharacterIds.has(item.id));
                    }
                    dispatch({
                      type: 'DISMISS_PLAYING_AS_TOAST',
                      nextCharacterId: nextItem?.id
                    });
                  }}
                  onDismiss={() => dispatch({ type: 'DISMISS_PLAYING_AS_TOAST' })}
                />
              </div>
            )}
            <Tooltip
              open={
                !activeIsSimple &&
                !showConfigure &&
                !isEnteringWorld &&
                !showPlayingAsToast &&
                (activeCoachmark === 'carousel' ||
                  activeCoachmark === 'cta-characters' ||
                  (activeCoachmark === 'cta-place' &&
                    !!selectedPlace &&
                    !(zoom && zoom.interactiveEntityId !== selectedPlace.id)))
              }
            >
              <TooltipTrigger render={<div />}>
                {imageLoaded && !activeIsSimple ? (
                  <InteractiveCarousel
                    items={carouselItems}
                    activeItemId={activeCarouselItemId}
                    onActiveChange={handleCarouselActiveChange}
                    selectedItemIds={
                      interactivePanel === 'characters'
                        ? selectedCharacterIds
                        : selectedPlaceIds
                    }
                    onItemSelect={(item: InteractiveCarouselItem) => {
                      if (interactivePanel === 'characters') {
                        toggleCharacterSelection({
                          id: item.id,
                          name: item.title,
                          imageUrl: item.imageUrl
                        });
                      } else {
                        togglePlaceSelection({
                          id: item.id,
                          name: item.title,
                          imageUrl: item.imageUrl
                        });
                      }
                    }}
                  />
                ) : null}
              </TooltipTrigger>
              <TooltipContent
                variant="primary"
                side="top"
                sideOffset={8}
                hideArrow={
                  activeCoachmark === 'cta-characters' || activeCoachmark === 'cta-place'
                }
                className={
                  activeCoachmark === 'cta-characters' || activeCoachmark === 'cta-place'
                    ? 'cursor-pointer'
                    : undefined
                }
                onClick={
                  activeCoachmark === 'cta-characters'
                    ? () => dispatch({ type: 'GO_NEXT' })
                    : activeCoachmark === 'cta-place'
                      ? () =>
                          dispatch({
                            type: selectedCharacters.length === 0 ? 'GO_BACK' : 'GO_NEXT'
                          })
                      : undefined
                }
              >
                {activeCoachmark === 'cta-characters' ? (
                  <>
                    That's everyone <IconArrowRight className="inline h-4 w-4" />
                  </>
                ) : activeCoachmark === 'cta-place' ? (
                  selectedCharacters.length === 0 ? (
                    <>
                      <IconArrowLeft className="inline h-4 w-4" /> Select characters
                    </>
                  ) : (
                    <>
                      Enter {selectedPlace?.name}{' '}
                      <IconArrowRight className="inline h-4 w-4" />
                    </>
                  )
                ) : currentStep === 'selectPlace' ? (
                  'Now pick your setting.'
                ) : (
                  "Pick who you'll play as."
                )}
              </TooltipContent>
            </Tooltip>
          </div>
          {showWelcome ? (
            <WelcomeDialog
              title={book.title}
              imageLoaded={imageLoaded}
              onBegin={() => dispatch({ type: 'DISMISS_WELCOME' })}
              containerRef={viewportRef}
            />
          ) : null}
          {showLoadingOverlay && (
            <WorldBuildingLoadingOverlay
              entities={[
                ...selectedCharacters.map((c) => ({
                  id: c.id,
                  name: c.name,
                  imageUrl: c.imageUrl
                })),
                ...(selectedPlace
                  ? [
                      {
                        id: selectedPlace.id,
                        name: selectedPlace.name,
                        imageUrl: selectedPlace.imageUrl
                      }
                    ]
                  : [])
              ]}
            />
          )}
          <InteractiveModal
            open={showMaxSelectionError}
            onClose={() => dispatch({ type: 'DISMISS_MAX_SELECTION_ERROR' })}
          >
            <div className="text-center">
              <p className="text-muted-foreground">
                Sorry! You can select up to {MAX_CHARACTER_SELECTIONS} characters.
              </p>
              <Button
                onClick={() => dispatch({ type: 'DISMISS_MAX_SELECTION_ERROR' })}
                size="lg"
                variant="primary"
                className="mt-6 w-full"
              >
                Got it
              </Button>
            </div>
          </InteractiveModal>
          <InteractiveModal
            open={!!pendingPlayerChange}
            onClose={() => dispatch({ type: 'CANCEL_PLAYER_CHANGE' })}
          >
            {pendingPlayerChange && (
              <>
                <div className="flex items-center gap-4">
                  {pendingPlayerChange.newPlayer.imageUrl && (
                    <img
                      src={transformImageUrl(pendingPlayerChange.newPlayer.imageUrl)}
                      alt={pendingPlayerChange.newPlayer.name}
                      className="h-20 w-20 shrink-0 rounded-full object-cover"
                    />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-bold text-foreground">
                      Change player character
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      You'll be playing as {pendingPlayerChange.newPlayer.name}.
                    </p>
                  </div>
                </div>
                <hr className="my-4" />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline-primary"
                    onClick={() => dispatch({ type: 'CANCEL_PLAYER_CHANGE' })}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => dispatch({ type: 'CONFIRM_PLAYER_CHANGE' })}
                  >
                    Play as {pendingPlayerChange.newPlayer.name}
                  </Button>
                </div>
              </>
            )}
          </InteractiveModal>
        </div>
      </div>
    </div>
  );
}
