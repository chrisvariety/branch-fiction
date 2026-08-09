export type Key = { k: string; label: string };

export function Cross({
  top,
  row,
  active,
  caption,
  onPress,
  onRelease
}: {
  top: Key;
  row: Key[];
  active: Set<string>;
  caption: string;
  onPress: (k: string) => void;
  onRelease: (k: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Cap
        label={top.label}
        on={active.has(top.k)}
        k={top.k}
        onPress={onPress}
        onRelease={onRelease}
      />
      <div className="flex gap-1">
        {row.map((key) => (
          <Cap
            key={key.k}
            label={key.label}
            on={active.has(key.k)}
            k={key.k}
            onPress={onPress}
            onRelease={onRelease}
          />
        ))}
      </div>
      <span className="mt-1 text-[10px] tracking-wide text-muted-foreground uppercase drop-shadow">
        {caption}
      </span>
    </div>
  );
}

export function Cap({
  label,
  on,
  k,
  onPress,
  onRelease
}: {
  label: string;
  on: boolean;
  k: string;
  onPress: (k: string) => void;
  onRelease: (k: string) => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onPress(k);
      }}
      onPointerUp={() => onRelease(k)}
      onPointerCancel={() => onRelease(k)}
      className={`grid h-9 w-9 cursor-pointer touch-none place-items-center rounded-md border text-sm font-medium backdrop-blur-sm transition-colors select-none ${
        on
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card/70 text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    el?.tagName === 'INPUT' ||
    el?.tagName === 'TEXTAREA' ||
    el?.isContentEditable === true
  );
}
