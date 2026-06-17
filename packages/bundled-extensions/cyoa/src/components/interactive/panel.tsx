import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import clsx from 'clsx';

import type { ZoomState } from './zoom';

export function EntityPolygon({
  points,
  isActive,
  isSelected
}: {
  points: string;
  isActive: boolean;
  isSelected?: boolean;
}) {
  const getStrokeClass = (
    selectedClass: string,
    activeClass: string,
    hoverClass: string
  ) => {
    if (isSelected) return selectedClass;
    if (isActive) return activeClass;
    return `stroke-white/0 ${hoverClass}`;
  };

  return (
    <>
      <polygon
        className={clsx(
          'pointer-events-none fill-transparent transition-colors duration-300 ease-in-out',
          getStrokeClass(
            'stroke-white/10',
            'stroke-white/20',
            'group-hover:stroke-white/10'
          )
        )}
        strokeWidth="16"
        points={points}
      />
      <polygon
        className={clsx(
          'pointer-events-none fill-transparent transition-colors duration-300 ease-in-out',
          getStrokeClass(
            'stroke-white/15',
            'stroke-white/30',
            'group-hover:stroke-white/20'
          )
        )}
        strokeWidth="12"
        points={points}
      />
      <polygon
        className={clsx(
          'pointer-events-none fill-transparent transition-colors duration-300 ease-in-out',
          getStrokeClass(
            'stroke-white/20',
            'stroke-white/40',
            'group-hover:stroke-white/30'
          )
        )}
        strokeWidth="8"
        points={points}
      />
      <polygon
        className={clsx(
          'cursor-pointer fill-transparent stroke-[4px] transition-colors duration-300 ease-in-out',
          isSelected
            ? 'fill-white/40 stroke-white/60'
            : isActive
              ? 'fill-white/15 stroke-white/60'
              : 'fill-transparent stroke-white/5 group-hover:fill-white/10 group-hover:stroke-white/40'
        )}
        points={points}
      />
    </>
  );
}

type InteractivePanelEntity = {
  id: string;
  clickArea: string | null;
  headArea: string | null;
  bookEntity: {
    id: string;
    name: string;
    identityTag: string | null;
    significanceRank: number | null;
    imageUrl: string | null;
  } | null;
};

type InteractivePanelProps = {
  panelKey: 'characters' | 'place';
  data: {
    url: string;
    videoUrl: string | null;
    width: number;
    height: number;
    bookInteractiveEntities: InteractivePanelEntity[];
  };
  isActive: boolean;
  activeEntityId: string;
  selectedEntityIds?: Set<string>;
  zoom?: ZoomState | null;
  isInteracting?: boolean;
  coachmarkLabel?: string;
  hidePolygons?: boolean;
  onPolygonClick: (
    e: React.MouseEvent,
    entityId: string,
    clickArea: string,
    headArea: string | null
  ) => void;
};

export function getBoundsFromPoints(pointsStr: string) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pair of pointsStr.split(' ')) {
    const [x, y] = pair.split(',').map(Number);
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return { minX, minY, maxX, maxY };
}

export function SvgCoachmark({
  label,
  entities,
  activeEntityId,
  viewBoxWidth
}: {
  label: string;
  entities: Array<{ id: string; clickArea: string | null; headArea: string | null }>;
  activeEntityId: string;
  viewBoxWidth: number;
}) {
  const entity = entities.find((e) => e.id === activeEntityId);
  const area = entity?.headArea ?? entity?.clickArea;
  if (!area) return null;

  const bounds = getBoundsFromPoints(area);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const headTopY = bounds.minY;

  // Scale sizes relative to viewBox so they look consistent across different image sizes
  const fontSize = viewBoxWidth * 0.028;
  const paddingX = fontSize * 0.8;
  const paddingY = fontSize * 0.5;
  const arrowSize = fontSize * 0.5;
  const gap = fontSize * 0.3;
  const cornerRadius = fontSize * 0.3;

  const textWidth = label.length * fontSize * 0.55;
  const rectWidth = textWidth + paddingX * 2;
  const rectHeight = fontSize + paddingY * 2;

  const arrowTipY = headTopY - gap;
  const rectBottom = arrowTipY - arrowSize;
  const rectTop = rectBottom - rectHeight;

  // Clamp rect horizontally so it stays within the viewBox
  const margin = fontSize * 0.5;
  const rectLeft = Math.max(
    margin,
    Math.min(centerX - rectWidth / 2, viewBoxWidth - rectWidth - margin)
  );

  const clipId = `coachmark-inset-${activeEntityId}`;
  const insetHighlight = fontSize * 0.06;

  const r = cornerRadius;
  const rectRight = rectLeft + rectWidth;

  // Clamp arrow x to stay within the rect (inset by corner radius + arrow size)
  const arrowMinX = rectLeft + r + arrowSize;
  const arrowMaxX = rectRight - r - arrowSize;
  const arrowX = Math.max(arrowMinX, Math.min(centerX, arrowMaxX));
  const arrowLeft = arrowX - arrowSize;
  const arrowRight = arrowX + arrowSize;

  const shapePath = [
    `M ${rectLeft + r},${rectTop}`,
    `H ${rectRight - r}`,
    `A ${r},${r} 0 0 1 ${rectRight},${rectTop + r}`,
    `V ${rectBottom - r}`,
    `A ${r},${r} 0 0 1 ${rectRight - r},${rectBottom}`,
    `H ${arrowRight}`,
    `L ${arrowX},${arrowTipY}`,
    `L ${arrowLeft},${rectBottom}`,
    `H ${rectLeft + r}`,
    `A ${r},${r} 0 0 1 ${rectLeft},${rectBottom - r}`,
    `V ${rectTop + r}`,
    `A ${r},${r} 0 0 1 ${rectLeft + r},${rectTop}`,
    'Z'
  ].join(' ');

  const textX = rectLeft + rectWidth / 2;

  return (
    <g className="pointer-events-none">
      <path d={shapePath} fill="#262626" stroke="#09090b" strokeWidth={1} />
      {/* Inset top highlight to mimic shadow-[inset_0_1px_0_#404040] */}
      <defs>
        <clipPath id={clipId}>
          <rect x={rectLeft} y={rectTop} width={rectWidth} height={insetHighlight} />
        </clipPath>
      </defs>
      <rect
        x={rectLeft + 1}
        y={rectTop + 1}
        width={rectWidth - 2}
        height={rectHeight - 2}
        rx={Math.max(r - 1, 0)}
        fill="none"
        stroke="#404040"
        strokeWidth={insetHighlight}
        clipPath={`url(#${clipId})`}
      />
      <text
        x={textX}
        y={rectTop + paddingY + fontSize * 0.82}
        textAnchor="middle"
        fill="white"
        fontSize={fontSize}
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight={400}
      >
        {label}
      </text>
    </g>
  );
}

export function InteractivePanel({
  panelKey,
  data,
  isActive,
  activeEntityId,
  selectedEntityIds,
  zoom, // only used for place, for characters there's a noticeable dip in quality if zoom is applied in this manner
  isInteracting = false,
  coachmarkLabel,
  hidePolygons = false,
  onPolygonClick
}: InteractivePanelProps) {
  const zoomStyle =
    isActive && zoom
      ? {
          transform: `translate(${zoom.translateX}px, ${zoom.translateY}px) scale(${zoom.scale})`
        }
      : { transform: 'translate(0px, 0px) scale(1)' };

  return (
    <div
      className={clsx(
        'relative h-full w-1/2 flex-none',
        isActive ? 'pointer-events-auto' : 'pointer-events-none'
      )}
    >
      <div className="absolute inset-0 origin-center">
        <div
          className={clsx(
            'absolute inset-0 origin-top-left will-change-transform motion-reduce:transition-none',
            isInteracting
              ? 'transition-none'
              : 'transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]'
          )}
          style={zoomStyle}
        >
          <img
            src={transformImageUrl(data.url)}
            alt={isActive ? 'Interactive Image' : ''}
            aria-hidden={isActive ? undefined : true}
            className="block h-full w-full select-none"
            draggable={false}
          />
          {panelKey === 'place' && data.videoUrl && (
            <video
              src={transformImageUrl(data.videoUrl, { optimize: false })}
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
              aria-hidden="true"
            />
          )}
          <svg
            viewBox={`0 0 ${data.width} ${data.height}`}
            xmlns="http://www.w3.org/2000/svg"
            className="absolute inset-0 h-full w-full"
          >
            {!hidePolygons &&
              data.bookInteractiveEntities?.map((entity) => {
                const bookEntity = entity.bookEntity;
                const clickArea = entity.clickArea;
                if (!bookEntity || !clickArea) return null;

                const isEntityActive = entity.id === activeEntityId;

                return (
                  <a
                    key={entity.id}
                    href="#"
                    className="group"
                    aria-label={bookEntity.name}
                    onClick={(e) =>
                      onPolygonClick(e, entity.id, clickArea, entity.headArea)
                    }
                  >
                    <title>{bookEntity.name}</title>
                    <EntityPolygon
                      points={clickArea}
                      isActive={isEntityActive}
                      isSelected={!!selectedEntityIds?.has(entity.id)}
                    />
                  </a>
                );
              })}
            {coachmarkLabel && (
              <SvgCoachmark
                label={coachmarkLabel}
                entities={data.bookInteractiveEntities}
                activeEntityId={activeEntityId}
                viewBoxWidth={data.width}
              />
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}
