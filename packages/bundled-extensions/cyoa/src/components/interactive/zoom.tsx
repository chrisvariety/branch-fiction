import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import clsx from 'clsx';
import { zoomIdentity, type ZoomTransform } from 'd3-zoom';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { useGestureNavigation } from '@/components/interactive/use-gesture-navigation';

import { EntityPolygon, getBoundsFromPoints, SvgCoachmark } from './panel';

export interface ZoomState {
  interactiveEntityId: string;
  scale: number;
  translateX: number;
  translateY: number;
}

export function useZoom({
  interactiveWidth,
  interactiveHeight,
  entities,
  activeEntityId,
  onActiveChange
}: {
  interactiveWidth: number;
  interactiveHeight: number;
  entities: Array<{
    id: string;
    clickArea: string | null;
    headArea: string | null;
  }>;
  activeEntityId: string;
  onActiveChange?: (entityId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewportRect = useElementRect(viewportRef);
  const frameRect = useElementRect(frameRef);
  const [zoom, setZoom] = useState<ZoomState | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  // Timeout refs for managing animations and auto-zoom
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoZoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestTransformRef = useRef<ZoomTransform>(zoomIdentity);
  const didMoveRef = useRef(false);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
      if (autoZoomTimeoutRef.current) {
        clearTimeout(autoZoomTimeoutRef.current);
      }
    };
  }, []);

  let zoomContentStyle: CSSProperties | undefined = undefined;
  if (zoom) {
    zoomContentStyle = {
      left: zoom.translateX,
      top: zoom.translateY,
      width: viewportRect.width * zoom.scale,
      height: viewportRect.height * zoom.scale
    };
  }

  // Clear all pending timeouts
  const clearTimeouts = () => {
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
    if (autoZoomTimeoutRef.current) {
      clearTimeout(autoZoomTimeoutRef.current);
      autoZoomTimeoutRef.current = null;
    }
  };

  const clampTranslate = (transform: ZoomTransform) => {
    if (
      viewportRect.width <= 0 ||
      viewportRect.height <= 0 ||
      frameRect.width <= 0 ||
      frameRect.height <= 0
    ) {
      return transform;
    }
    const frameOffsetX = frameRect.left - viewportRect.left;
    const frameOffsetY = frameRect.top - viewportRect.top;
    const minTranslateX =
      viewportRect.width - frameOffsetX - frameRect.width * transform.k;
    const maxTranslateX = -frameOffsetX;
    const minTranslateY =
      viewportRect.height - frameOffsetY - frameRect.height * transform.k;
    const maxTranslateY = -frameOffsetY;

    return zoomIdentity
      .translate(
        clamp(transform.x, minTranslateX, maxTranslateX),
        clamp(transform.y, minTranslateY, maxTranslateY)
      )
      .scale(transform.k);
  };

  // Calculate zoom parameters for an entity
  const calculateZoom = (
    interactiveEntityId: string,
    clickArea: string,
    headArea: string | null,
    minScale: number = 1.2,
    maxScale: number = 2
  ): ZoomState | null => {
    if (
      viewportRect.width <= 0 ||
      viewportRect.height <= 0 ||
      frameRect.width <= 0 ||
      frameRect.height <= 0
    ) {
      return null;
    }

    const bounds = getBoundsFromPoints(headArea || clickArea);

    const boundsWidth = Math.max(bounds.maxX - bounds.minX, 1);
    const boundsHeight = Math.max(bounds.maxY - bounds.minY, 1);

    const renderRect = getRenderedImageRect({
      viewportWidth: frameRect.width,
      viewportHeight: frameRect.height,
      imageWidth: interactiveWidth,
      imageHeight: interactiveHeight,
      fit: 'contain',
      position: 'center'
    });

    const targetScaleFromWidth = viewportRect.width / (boundsWidth * renderRect.scale);
    const targetScaleFromHeight = viewportRect.height / (boundsHeight * renderRect.scale);
    const targetScale = clamp(
      Math.min(targetScaleFromWidth, targetScaleFromHeight) * 0.9,
      minScale,
      maxScale
    );

    const focusX = (bounds.minX + bounds.maxX) / 2;
    const focusY = (bounds.minY + bounds.maxY) / 2;

    const focusXPx = renderRect.offsetX + focusX * renderRect.scale;
    const focusYPx = renderRect.offsetY + focusY * renderRect.scale;
    const frameOffsetX = frameRect.left - viewportRect.left;
    const frameOffsetY = frameRect.top - viewportRect.top;

    const unclampedTranslateX =
      viewportRect.width / 2 - frameOffsetX - focusXPx * targetScale;
    const unclampedTranslateY =
      viewportRect.height / 2 - frameOffsetY - focusYPx * targetScale;

    const minTranslateX =
      viewportRect.width - frameOffsetX - frameRect.width * targetScale;
    const maxTranslateX = -frameOffsetX;
    const minTranslateY =
      viewportRect.height - frameOffsetY - frameRect.height * targetScale;
    const maxTranslateY = -frameOffsetY;
    const translateX = Math.round(
      clamp(unclampedTranslateX, minTranslateX, maxTranslateX)
    );
    const translateY = Math.round(
      clamp(unclampedTranslateY, minTranslateY, maxTranslateY)
    );

    return { interactiveEntityId, scale: targetScale, translateX, translateY };
  };

  const findNearestEntityForTransform = (transform: ZoomTransform) =>
    findNearestEntity(transform, entities, {
      viewportRect,
      frameRect,
      interactiveWidth,
      interactiveHeight
    });

  const getTransformForZoom = (targetZoom: ZoomState) =>
    zoomIdentity
      .translate(targetZoom.translateX, targetZoom.translateY)
      .scale(targetZoom.scale);

  const { applyTransform } = useGestureNavigation({
    elementRef: viewportRef,
    minScale: 1,
    maxScale: 2,
    onZoomStart: (_transform, sourceEvent) => {
      if (sourceEvent) {
        setIsInteracting(true);
        didMoveRef.current = false;
      }
    },
    onZoom: (transform, sourceEvent) => {
      const clamped = clampTranslate(transform);
      if (clamped.x !== transform.x || clamped.y !== transform.y) {
        applyTransform(clamped);
      }

      const prev = latestTransformRef.current;
      if (
        sourceEvent &&
        (Math.abs(clamped.x - prev.x) > 0.5 || Math.abs(clamped.y - prev.y) > 0.5)
      ) {
        didMoveRef.current = true;
      }
      if (
        prev.k === clamped.k &&
        prev.x === clamped.x &&
        prev.y === clamped.y &&
        sourceEvent === null
      ) {
        return;
      }
      latestTransformRef.current = clamped;

      setZoom((current) => ({
        interactiveEntityId: current?.interactiveEntityId ?? activeEntityId,
        scale: clamped.k,
        translateX: clamped.x,
        translateY: clamped.y
      }));
    },
    onZoomEnd: (transform, sourceEvent) => {
      if (!sourceEvent) return;
      setIsInteracting(false);
      if (didMoveRef.current) {
        const clamped = clampTranslate(transform);
        if (clamped.k > 1) {
          const candidate = findNearestEntityForTransform(clamped);
          if (candidate?.clickArea) {
            onActiveChange?.(candidate.id);
          }
        }
      }
      didMoveRef.current = false;
    }
  });

  // Apply zoom with animation
  const applyZoom = (targetZoom: ZoomState) => {
    const nextTransform = getTransformForZoom(targetZoom);
    latestTransformRef.current = nextTransform;
    applyTransform(nextTransform);
    if (!zoom) {
      // Animate from scale 1
      setZoom({ ...targetZoom, scale: 1, translateX: 0, translateY: 0 });
      // Double rAF ensures browser has painted the intermediate state before animating
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setZoom(targetZoom));
      });
    } else {
      setZoom(targetZoom);
    }
  };

  // Auto-zoom to an entity, optionally after a delay
  const scheduleAutoZoom = (
    interactiveEntityId: string,
    clickArea: string,
    headArea: string | null,
    delay: number = 2000,
    minScale?: number,
    maxScale?: number
  ) => {
    clearTimeouts();

    const run = () => {
      autoZoomTimeoutRef.current = null;
      const targetZoom = calculateZoom(
        interactiveEntityId,
        clickArea,
        headArea,
        minScale,
        maxScale
      );
      if (targetZoom) {
        applyZoom(targetZoom);
      }
    };

    if (delay <= 0) {
      run();
    } else {
      autoZoomTimeoutRef.current = setTimeout(run, delay);
    }
  };

  // Cancel any scheduled auto-zoom
  const cancelAutoZoom = () => {
    if (autoZoomTimeoutRef.current) {
      clearTimeout(autoZoomTimeoutRef.current);
      autoZoomTimeoutRef.current = null;
    }
  };

  const resetZoom = () => {
    if (!zoom) return;
    clearTimeouts();
    setZoom(null);
    applyTransform(zoomIdentity);
  };

  const handlePolygonClick = (
    e: ReactMouseEvent,
    interactiveEntityId: string,
    clickArea: string,
    headArea: string | null
  ) => {
    e.preventDefault();
    e.stopPropagation();

    clearTimeouts();

    // Notify parent of active change
    onActiveChange?.(interactiveEntityId);

    // Toggle zoom off if clicking same entity and zoomed in
    if (zoom?.interactiveEntityId === interactiveEntityId && zoom.scale !== 1) {
      resetZoom();
      return;
    }

    const targetZoom = calculateZoom(interactiveEntityId, clickArea, headArea);
    if (targetZoom) {
      applyZoom(targetZoom);
    }
  };

  return {
    viewportRef,
    frameRef,
    zoom,
    zoomContentStyle,
    isInteracting,
    handlePolygonClick,
    resetZoom,
    scheduleAutoZoom,
    cancelAutoZoom
  };
}

interface ZoomedOverlayProps {
  zoom: ZoomState | null;
  zoomContentStyle: CSSProperties | undefined;
  isInteracting?: boolean;
  children: ReactNode;
}

export function ZoomedOverlay({
  zoom,
  zoomContentStyle,
  isInteracting = false,
  children
}: ZoomedOverlayProps) {
  return (
    <div
      className={clsx(
        'absolute inset-0 overflow-hidden',
        zoom ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      )}
    >
      <div
        className={clsx(
          'absolute origin-top-left will-change-[left,top,width,height] motion-reduce:transition-none',
          isInteracting
            ? 'transition-none'
            : 'transition-[left,top,width,height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]'
        )}
        style={zoomContentStyle}
      >
        {children}
      </div>
    </div>
  );
}

interface ZoomedOverlayContentProps {
  imageUrl: string;
  videoUrl?: string | null;
  width: number;
  height: number;
  entities: Array<{
    id: string;
    clickArea: string | null;
    headArea: string | null;
    bookEntity: {
      id: string;
      name: string;
    } | null;
  }>;
  activeEntityId: string;
  selectedEntityIds?: Set<string>;
  coachmarkLabel?: string;
  onPolygonClick: (
    e: ReactMouseEvent,
    entityId: string,
    clickArea: string,
    headArea: string | null
  ) => void;
}

export function ZoomedOverlayContent({
  imageUrl,
  videoUrl,
  width,
  height,
  entities,
  activeEntityId,
  selectedEntityIds,
  coachmarkLabel,
  onPolygonClick
}: ZoomedOverlayContentProps) {
  return (
    <>
      <img
        src={transformImageUrl(imageUrl)}
        alt=""
        aria-hidden="true"
        className="block h-full w-full select-none"
        draggable={false}
      />
      {videoUrl && (
        <video
          src={transformImageUrl(videoUrl, { optimize: false })}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
          aria-hidden="true"
        />
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 h-full w-full"
      >
        {entities.map((entity) => {
          const bookEntity = entity.bookEntity;
          const clickArea = entity.clickArea;
          if (!bookEntity || !clickArea) return null;

          const isActive = entity.id === activeEntityId;

          return (
            <a
              key={entity.id}
              href="#"
              className="group"
              aria-label={bookEntity.name}
              onClick={(e) => onPolygonClick(e, entity.id, clickArea, entity.headArea)}
            >
              <title>{bookEntity.name}</title>
              <EntityPolygon
                points={clickArea}
                isActive={isActive}
                isSelected={!!selectedEntityIds?.has(entity.id)}
              />
            </a>
          );
        })}
        {coachmarkLabel && (
          <SvgCoachmark
            label={coachmarkLabel}
            entities={entities}
            activeEntityId={activeEntityId}
            viewBoxWidth={width}
          />
        )}
      </svg>
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function findNearestEntity(
  transform: ZoomTransform,
  entities: Array<{ id: string; clickArea: string | null; headArea: string | null }>,
  {
    viewportRect,
    frameRect,
    interactiveWidth,
    interactiveHeight
  }: {
    viewportRect: ElementRect;
    frameRect: ElementRect;
    interactiveWidth: number;
    interactiveHeight: number;
  }
) {
  if (entities.length === 0) return null;
  if (
    viewportRect.width <= 0 ||
    viewportRect.height <= 0 ||
    frameRect.width <= 0 ||
    frameRect.height <= 0
  ) {
    return null;
  }

  const renderRect = getRenderedImageRect({
    viewportWidth: frameRect.width,
    viewportHeight: frameRect.height,
    imageWidth: interactiveWidth,
    imageHeight: interactiveHeight,
    fit: 'contain',
    position: 'center'
  });

  const viewportCenterX = viewportRect.width / 2;
  const viewportCenterY = viewportRect.height / 2;
  const frameOffsetX = frameRect.left - viewportRect.left;
  const frameOffsetY = frameRect.top - viewportRect.top;

  let best: { entity: (typeof entities)[0]; distance: number } | null = null;

  for (const entity of entities) {
    const area = entity.headArea ?? entity.clickArea;
    if (!area) continue;
    const bounds = getBoundsFromPoints(area);
    const focusX = (bounds.minX + bounds.maxX) / 2;
    const focusY = (bounds.minY + bounds.maxY) / 2;
    const focusXPx = renderRect.offsetX + focusX * renderRect.scale;
    const focusYPx = renderRect.offsetY + focusY * renderRect.scale;
    const screenX = frameOffsetX + focusXPx * transform.k + transform.x;
    const screenY = frameOffsetY + focusYPx * transform.k + transform.y;
    const dx = screenX - viewportCenterX;
    const dy = screenY - viewportCenterY;
    const distance = dx * dx + dy * dy;

    if (!best || distance < best.distance) {
      best = { entity, distance };
    }
  }

  return best?.entity ?? null;
}

type ElementRect = {
  width: number;
  height: number;
  left: number;
  top: number;
};

function useElementRect<T extends HTMLElement = HTMLDivElement>(
  ref: React.RefObject<T | null>
): ElementRect {
  const [rect, setRect] = useState<ElementRect>({
    width: 0,
    height: 0,
    left: 0,
    top: 0
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const next = element.getBoundingClientRect();
      setRect({
        width: next.width,
        height: next.height,
        left: next.left,
        top: next.top
      });
    };

    const observer = new ResizeObserver(() => update());
    observer.observe(element);
    const raf = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, [ref]);

  return rect;
}

function getRenderedImageRect({
  viewportWidth,
  viewportHeight,
  imageWidth,
  imageHeight,
  fit,
  position
}: {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
  fit: 'cover' | 'contain';
  position: 'center' | 'bottom';
}) {
  const scale =
    fit === 'cover'
      ? Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight)
      : Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);

  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const offsetX = (viewportWidth - width) / 2;
  const offsetY =
    position === 'bottom' ? viewportHeight - height : (viewportHeight - height) / 2;

  return { scale, width, height, offsetX, offsetY };
}
