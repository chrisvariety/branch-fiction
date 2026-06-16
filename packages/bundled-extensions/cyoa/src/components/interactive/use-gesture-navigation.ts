import type { Selection } from 'd3-selection';
import { select } from 'd3-selection';
import { zoom as d3Zoom, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { useCallback, useEffect, useRef } from 'react';

type ZoomDatum = Record<string, never>;

type GestureNavigationOptions = {
  elementRef: React.RefObject<HTMLElement | null>;
  onZoom: (transform: ZoomTransform, sourceEvent: Event | null) => void;
  onZoomStart?: (transform: ZoomTransform, sourceEvent: Event | null) => void;
  onZoomEnd?: (transform: ZoomTransform, sourceEvent: Event | null) => void;
  minScale?: number;
  maxScale?: number;
  enabled?: boolean;
};

export function useGestureNavigation({
  elementRef,
  onZoom,
  onZoomStart,
  onZoomEnd,
  minScale = 1,
  maxScale = 2,
  enabled = true
}: GestureNavigationOptions) {
  const behaviorRef = useRef<ZoomBehavior<HTMLElement, ZoomDatum> | null>(null);
  const selectionRef = useRef<Selection<HTMLElement, ZoomDatum, null, undefined> | null>(
    null
  );

  const applyTransform = useCallback((transform: ZoomTransform) => {
    const behavior = behaviorRef.current;
    const selection = selectionRef.current;
    if (!behavior || !selection) return;
    behavior.transform(selection, transform);
  }, []);

  useEffect(() => {
    const handleZoomStart = (event: {
      transform: ZoomTransform;
      sourceEvent: Event | null;
    }) => {
      onZoomStart?.(event.transform, event.sourceEvent ?? null);
    };

    const handleZoomEnd = (event: {
      transform: ZoomTransform;
      sourceEvent: Event | null;
    }) => {
      onZoomEnd?.(event.transform, event.sourceEvent ?? null);
    };

    const handleZoom = (event: {
      transform: ZoomTransform;
      sourceEvent: Event | null;
    }) => {
      onZoom?.(event.transform, event.sourceEvent ?? null);
    };

    const el = elementRef.current;
    if (!el || !enabled) return;

    const selection = select<HTMLElement, ZoomDatum>(el);
    const behavior = d3Zoom<HTMLElement, ZoomDatum>()
      .scaleExtent([minScale, maxScale])
      .clickDistance(10)
      .filter((event) => {
        if (!enabled) return false;
        const target = event?.target instanceof Element ? event.target : null;

        if (target?.closest('[data-gesture-ignore="true"]')) {
          return false;
        }
        if (event.type === 'dblclick') return false;
        if ('button' in event && event.button !== 0) return false;
        return true;
      })
      .on('start', handleZoomStart)
      .on('zoom', handleZoom)
      .on('end', handleZoomEnd);

    selection.call(behavior);
    behaviorRef.current = behavior;
    selectionRef.current = selection;

    return () => {
      selection.on('.zoom', null);
      behaviorRef.current = null;
      selectionRef.current = null;
    };
  }, [elementRef, enabled, maxScale, minScale, onZoom, onZoomStart, onZoomEnd]);

  return { applyTransform };
}
