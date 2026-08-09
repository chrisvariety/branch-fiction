import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import type { ReactNode, RefObject } from 'react';

export function WorldStage({
  stageRef,
  seedImageUrl,
  playing,
  onExit,
  video,
  overlay,
  controls,
  badge
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  seedImageUrl: string;
  playing: boolean;
  onExit: () => void;
  video: ReactNode;
  overlay: ReactNode;
  controls: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="flex h-screen items-center justify-center bg-background p-3">
      <div className="relative flex w-full max-w-[calc((100vh-1.5rem)*16/9)] flex-col">
        <div
          ref={stageRef}
          className="relative aspect-video max-h-full w-full flex-none overflow-hidden rounded-2xl bg-black"
        >
          {video}
          {badge && <div className="absolute top-3 left-3 z-10">{badge}</div>}
          <button
            aria-label="Exit"
            className="absolute top-3 right-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-black/40 text-lg leading-none text-white/80 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
            onClick={onExit}
          >
            ✕
          </button>
          <img
            src={transformImageUrl(seedImageUrl)}
            alt=""
            aria-hidden
            className={`pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-2xl transition-opacity duration-1000 ${
              playing ? 'opacity-0' : 'opacity-100'
            }`}
          />
          {!playing && overlay && (
            <div className="absolute inset-0 grid place-items-center px-8 text-center">
              {overlay}
            </div>
          )}
        </div>
        {controls}
      </div>
    </div>
  );
}

export function StageMessage({ children }: { children: ReactNode }) {
  return <span className="text-sm text-white/80 drop-shadow">{children}</span>;
}

export function StageError({ children }: { children: ReactNode }) {
  return <span className="text-sm text-red-400">{children}</span>;
}

export function StagePrompt({
  title,
  detail,
  actions
}: {
  title: string;
  detail?: string;
  actions: { label: string; onClick: () => void; primary?: boolean }[];
}) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3">
      <span className="text-sm font-medium text-white/90 drop-shadow">{title}</span>
      {detail && <span className="text-xs text-white/70 drop-shadow">{detail}</span>}
      <div className="flex gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            className={
              action.primary
                ? 'rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black transition-colors hover:bg-white/90'
                : 'rounded-full border border-white/30 px-4 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10'
            }
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
