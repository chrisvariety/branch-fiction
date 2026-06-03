import {
  IconAlertCircleFilled,
  IconLoader2,
  IconPlayerPauseFilled
} from '@tabler/icons-react';
import type { MouseEvent } from 'react';

import { useDominantColor } from '@/hooks/use-dominant-color';

const SPINE_WIDTH = 20;

type ImportStatus =
  | 'pending'
  | 'projection'
  | 'awaiting_projection'
  | 'extract'
  | 'awaiting_selection'
  | 'arc'
  | 'completed'
  | 'failed';

interface BookCoverFigureProps {
  title: string;
  imageUrl?: string | null;
  importStatus?: ImportStatus | null;
  importActive?: boolean;
}

export function BookCoverFigure({
  title,
  imageUrl,
  importStatus,
  importActive
}: BookCoverFigureProps) {
  const spineColor = useDominantColor(imageUrl);

  return (
    <div className="w-full overflow-visible" style={{ perspective: 600 }}>
      <div
        className="relative transition-transform duration-300 ease-out group-hover:transform-[rotateY(20deg)]"
        style={{
          transformStyle: 'preserve-3d',
          transformOrigin: 'left center'
        }}
      >
        {/* Front cover */}
        <div
          className="relative aspect-2/3 w-full overflow-hidden rounded-l-xs rounded-r shadow-lg ring-1 ring-border"
          style={{ backfaceVisibility: 'hidden' }}
        >
          {imageUrl ? (
            <img src={imageUrl} alt={title} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center bg-muted p-3">
              <p className="line-clamp-6 text-center text-sm font-medium text-muted-foreground">
                {title}
              </p>
            </div>
          )}
          {importStatus && importStatus !== 'completed' && (
            <div className="absolute top-1 right-1 drop-shadow">
              {importStatus === 'failed' ? (
                <IconAlertCircleFilled className="size-4 text-destructive" />
              ) : importActive === false ? (
                <IconPlayerPauseFilled className="size-4 text-white" />
              ) : (
                <IconLoader2 className="size-4 animate-spin text-white" />
              )}
            </div>
          )}
        </div>

        {/* Spine */}
        <div
          className="absolute inset-y-0 right-full origin-right rounded-l"
          style={{
            width: SPINE_WIDTH,
            transform: 'rotateY(-90deg)',
            backgroundColor: spineColor ?? 'var(--muted)',
            backfaceVisibility: 'hidden'
          }}
        />

        {/* Top edge */}
        <div
          className="absolute inset-x-0 bottom-full origin-bottom"
          style={{
            height: SPINE_WIDTH,
            transform: 'rotateX(90deg)',
            backgroundColor: 'var(--muted)',
            backfaceVisibility: 'hidden'
          }}
        />
      </div>
    </div>
  );
}

interface BookCoverProps extends BookCoverFigureProps {
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}

export function BookCover({ onClick, onContextMenu, ...figure }: BookCoverProps) {
  return (
    <button
      type="button"
      className="group flex flex-col items-start gap-2 overflow-visible text-left"
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <BookCoverFigure {...figure} />
    </button>
  );
}
