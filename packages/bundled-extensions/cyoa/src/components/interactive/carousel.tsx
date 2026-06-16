// @ts-ignore
import { BlossomCarousel } from '@blossom-carousel/react';
import clsx from 'clsx';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import { Button } from '@/components/ui/button';
import { useIsomorphicLayoutEffect } from '@/hooks/use-isomorphic-layout-effect';

interface BlossomCarouselHandle {
  prev: (options?: { align?: string }) => void;
  next: (options?: { align?: string }) => void;
  element: HTMLElement | null;
}

export type InteractiveCarouselItem = {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
};

const supportsSnapEvents =
  typeof HTMLElement !== 'undefined' && 'onscrollsnapchange' in HTMLElement.prototype;

export function InteractiveCarousel({
  items,
  activeItemId,
  onActiveChange,
  selectedItemIds,
  onItemSelect
}: {
  items: InteractiveCarouselItem[];
  activeItemId: string;
  onActiveChange?: (id: string) => void;
  selectedItemIds: Set<string>;
  onItemSelect?: (item: InteractiveCarouselItem) => void;
}) {
  const carouselRef = useScrollSnapEvents({ items, activeItemId, onActiveChange });
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const lastHeightRef = useRef<number | null>(null);

  // Create a stable key from item IDs to detect when items change
  const itemIds = items.map((i) => i.id).join(',');

  const measureHeights = () => {
    const heights = Array.from(cardRefs.current.values()).map(
      (element) => element.getBoundingClientRect().height
    );
    const maxHeight = heights.length ? Math.max(...heights) : 0;
    const nextHeight = maxHeight || null;
    if (lastHeightRef.current === nextHeight) return;
    lastHeightRef.current = nextHeight;
    cardRefs.current.forEach((element) => {
      element.style.height = nextHeight ? `${nextHeight}px` : '';
    });
  };

  const remeasure = () => {
    lastHeightRef.current = null;
    cardRefs.current.forEach((el) => {
      el.style.height = '';
    });
    measureHeights();
  };

  useIsomorphicLayoutEffect(() => {
    // Reset cached height so fresh elements are always equalized,
    // even if the new max happens to match the previous value.
    lastHeightRef.current = null;

    const elements = Array.from(cardRefs.current.values());
    if (!elements.length) return;

    measureHeights();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measureHeights();
    });

    elements.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
    };
  }, [itemIds]);

  return (
    <div
      className="pointer-events-auto relative w-full"
      data-gesture-ignore="true"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative">
        <BlossomCarousel
          ref={carouselRef}
          className={clsx(
            'flex w-full snap-x items-stretch overflow-visible',
            supportsSnapEvents ? 'snap-proximity' : 'snap-mandatory'
          )}
        >
          {items.map((item, index) => (
            <div
              key={item.id}
              data-carousel-id={item.id}
              className={clsx(
                'flex w-[89%] flex-none snap-center snap-always pr-2',
                index === 0 && 'ml-2'
              )}
            >
              <div
                ref={(element) => {
                  if (element) {
                    cardRefs.current.set(item.id, element);
                  } else {
                    cardRefs.current.delete(item.id);
                  }
                }}
                className="h-full w-full rounded-xl bg-white p-3 shadow-lg backdrop-blur-sm"
              >
                <TitleDescriptionCarouselItem
                  title={item.title}
                  description={item.description}
                  selected={selectedItemIds.has(item.id)}
                  onSelect={onItemSelect ? () => onItemSelect(item) : undefined}
                  onRemeasure={remeasure}
                />
              </div>
            </div>
          ))}
        </BlossomCarousel>
      </div>
      {items.length > 1 && (
        <div className="flex justify-center gap-2">
          {items.map((item) => {
            const isActive = item.id === activeItemId;
            return (
              <motion.button
                key={item.id}
                type="button"
                aria-label={`Go to item ${item.id}`}
                onClick={() => onActiveChange?.(item.id)}
                animate={{ width: isActive ? 16 : 8 }}
                transition={{ type: 'tween', duration: 0.3, ease: 'easeInOut' }}
                className="relative my-0.5 h-2 rounded-full border border-gray-100"
              >
                {isActive && (
                  <motion.div
                    layoutId="carousel-dot"
                    className="absolute -inset-px rounded-full bg-gray-100"
                    transition={{ type: 'tween', duration: 0.3, ease: 'easeInOut' }}
                  />
                )}
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TitleDescriptionCarouselItem({
  title,
  description,
  selected,
  onSelect,
  onRemeasure
}: {
  title: string;
  description?: string;
  selected?: boolean;
  onSelect?: () => void;
  onRemeasure?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const descRef = useRef<HTMLDivElement | null>(null);

  const checkTruncation = () => {
    const titleEl = titleRef.current;
    const descEl = descRef.current;
    const titleClipped = !!titleEl && titleEl.scrollWidth > titleEl.clientWidth;
    const descClipped =
      !!descEl &&
      (descEl.scrollHeight > descEl.clientHeight ||
        descEl.scrollWidth > descEl.clientWidth);
    setIsTruncated(titleClipped || descClipped);
  };

  const titleCallbackRef = (el: HTMLDivElement | null) => {
    titleRef.current = el;
    if (el && !expanded) checkTruncation();
  };

  const descCallbackRef = (el: HTMLDivElement | null) => {
    descRef.current = el;
    if (el && !expanded) checkTruncation();
  };

  useEffect(() => {
    if (expanded) return;

    const observer = new ResizeObserver(checkTruncation);
    if (titleRef.current) observer.observe(titleRef.current);
    if (descRef.current) observer.observe(descRef.current);
    if (!titleRef.current && !descRef.current) return;
    return () => observer.disconnect();
  }, [expanded]);

  useEffect(() => {
    onRemeasure?.();
  }, [expanded, onRemeasure]);

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-baseline gap-1">
        <div
          ref={titleCallbackRef}
          className={clsx(
            'flex-1 text-sm font-semibold text-gray-900',
            !expanded && 'min-w-0 truncate'
          )}
        >
          {title}
        </div>
        {isTruncated && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="shrink-0 text-xs text-gray-400 underline underline-offset-2"
          >
            {expanded ? 'less' : 'more'}
          </button>
        )}
      </div>
      <div className="flex grow items-end justify-between gap-3">
        {description && (
          <div
            className={clsx(
              'min-w-0 flex-1 self-stretch text-xs text-gray-700',
              !expanded && 'carousel-desc-container'
            )}
          >
            <div
              ref={descCallbackRef}
              className={clsx(!expanded && 'carousel-desc-content')}
            >
              {description}
            </div>
          </div>
        )}
        {onSelect && (
          <Button
            variant={selected ? 'outline-primary' : 'primary'}
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className="min-w-21 shrink-0 px-2"
          >
            {selected ? 'Selected' : 'Select'}
          </Button>
        )}
      </div>
    </div>
  );
}

function useScrollSnapEvents({
  items,
  activeItemId,
  onActiveChange
}: {
  items: InteractiveCarouselItem[];
  activeItemId: string;
  onActiveChange?: (id: string) => void;
}) {
  const carouselRef = useRef<BlossomCarouselHandle | null>(null);
  const lastActiveIdRef = useRef<string | null>(null);
  const suppressSnapEventsRef = useRef(false);
  const debouncedActivate = useDebouncedCallback((id: string) => {
    if (!id || id === lastActiveIdRef.current) return;
    lastActiveIdRef.current = id;
    onActiveChange?.(id);
  }, 50);

  useEffect(() => {
    lastActiveIdRef.current = activeItemId ?? null;
  }, [activeItemId]);

  useEffect(() => {
    const element = carouselRef.current?.element;
    if (!element || !items.length) return;

    const activate = (id: string) => {
      if (!id || id === lastActiveIdRef.current) return;
      lastActiveIdRef.current = id;
      onActiveChange?.(id);
    };

    const extractSnapId = (event: Event): string | undefined => {
      // Blossom (desktop) dispatches CustomEvent with detail.snapTargetInline
      // Native spec & polyfill (mobile) put snapTargetInline directly on the event
      const snapEvent = event as Event & { snapTargetInline?: HTMLElement | null };
      const target =
        (event as CustomEvent<{ snapTargetInline: HTMLElement | null }>).detail
          ?.snapTargetInline ?? snapEvent.snapTargetInline;
      return target?.dataset.carouselId;
    };

    const handleSnapChange = (event: Event) => {
      if (suppressSnapEventsRef.current) return;
      const id = extractSnapId(event);
      if (id) activate(id);
    };

    const handleSnapChanging = (event: Event) => {
      if (suppressSnapEventsRef.current) return;
      const id = extractSnapId(event);
      if (id) debouncedActivate(id);
    };

    // On touch devices, detect nearest-to-center item on scroll for immediate
    // feedback rather than waiting for snap events which can lag on mobile.
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    let scrollRaf = 0;
    const handleScroll = isTouch
      ? () => {
          if (suppressSnapEventsRef.current) return;
          if (scrollRaf) return;
          scrollRaf = requestAnimationFrame(() => {
            scrollRaf = 0;
            const containerRect = element.getBoundingClientRect();
            const centerX = containerRect.left + containerRect.width / 2;
            let bestId: string | null = null;
            let bestDist = Infinity;
            for (const child of element.children) {
              const id = (child as HTMLElement).dataset?.carouselId;
              if (!id) continue;
              const rect = child.getBoundingClientRect();
              const dist = Math.abs(rect.left + rect.width / 2 - centerX);
              if (dist < bestDist) {
                bestDist = dist;
                bestId = id;
              }
            }
            if (bestId) activate(bestId);
          });
        }
      : null;

    element.addEventListener('scrollsnapchange', handleSnapChange);
    element.addEventListener('scrollsnapchanging', handleSnapChanging);
    if (handleScroll) {
      element.addEventListener('scroll', handleScroll, { passive: true });
    }

    return () => {
      element.removeEventListener('scrollsnapchange', handleSnapChange);
      element.removeEventListener('scrollsnapchanging', handleSnapChanging);
      if (handleScroll) element.removeEventListener('scroll', handleScroll);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
    };
  }, [items, onActiveChange, debouncedActivate]);

  useEffect(() => {
    const element = carouselRef.current?.element;
    if (!element) return;
    const target = element.querySelector<HTMLElement>(
      `[data-carousel-id="${activeItemId}"]`
    );
    if (!target) return;

    // Suppress snap events during programmatic scroll to avoid
    // intermediate snap positions overriding the intended target
    suppressSnapEventsRef.current = true;

    const scrollToTarget = () => {
      const containerRect = element.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetCenterOffset =
        targetRect.left -
        containerRect.left -
        (containerRect.width - targetRect.width) / 2;
      element.scrollTo({
        left: element.scrollLeft + targetCenterOffset,
        behavior: 'smooth'
      });
    };

    const frame = window.requestAnimationFrame(scrollToTarget);
    // Re-enable after the smooth scroll has time to settle
    const timeout = setTimeout(() => {
      suppressSnapEventsRef.current = false;
    }, 500);
    return () => {
      window.cancelAnimationFrame(frame);
      clearTimeout(timeout);
      suppressSnapEventsRef.current = false;
    };
  }, [activeItemId]);

  return carouselRef;
}
