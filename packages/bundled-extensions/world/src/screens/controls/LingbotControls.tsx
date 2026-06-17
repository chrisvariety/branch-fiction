import { useEffect, useState } from 'react';

type SendCommand = (command: string, data: unknown) => Promise<void>;

type Movement = 'idle' | 'forward' | 'back' | 'strafe_left' | 'strafe_right';
type LookH = 'idle' | 'left' | 'right';
type LookV = 'idle' | 'up' | 'down';

const MOVEMENT_KEYS: Record<string, Movement> = {
  w: 'forward',
  s: 'back',
  a: 'strafe_left',
  d: 'strafe_right'
};
const LOOK_H_KEYS: Record<string, LookH> = { arrowleft: 'left', arrowright: 'right' };
const LOOK_V_KEYS: Record<string, LookV> = { arrowup: 'up', arrowdown: 'down' };

// Each key sets its axis to a value while held; releasing resets that axis to idle.
function commandFor(k: string): { command: string; field: string; value: string } | null {
  if (MOVEMENT_KEYS[k])
    return { command: 'set_movement', field: 'movement', value: MOVEMENT_KEYS[k] };
  if (LOOK_H_KEYS[k])
    return {
      command: 'set_look_horizontal',
      field: 'look_horizontal',
      value: LOOK_H_KEYS[k]
    };
  if (LOOK_V_KEYS[k])
    return {
      command: 'set_look_vertical',
      field: 'look_vertical',
      value: LOOK_V_KEYS[k]
    };
  return null;
}

export function LingbotControls({ sendCommand }: { sendCommand: SendCommand }) {
  const [active, setActive] = useState<Set<string>>(() => new Set());

  const mark = (k: string, on: boolean) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });

  const press = (k: string) => {
    const cmd = commandFor(k);
    if (!cmd) return;
    mark(k, true);
    void sendCommand(cmd.command, { [cmd.field]: cmd.value });
  };

  const release = (k: string) => {
    const cmd = commandFor(k);
    if (!cmd) return;
    mark(k, false);
    void sendCommand(cmd.command, { [cmd.field]: 'idle' });
  };

  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return (
        el?.tagName === 'INPUT' ||
        el?.tagName === 'TEXTAREA' ||
        el?.isContentEditable === true
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (commandFor(k)) {
        e.preventDefault();
        press(k);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      release(e.key.toLowerCase());
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendCommand]);

  return (
    <>
      <div className="absolute bottom-4 left-4">
        <Cross
          top={{ k: 'w', label: 'W' }}
          row={[
            { k: 'a', label: 'A' },
            { k: 's', label: 'S' },
            { k: 'd', label: 'D' }
          ]}
          active={active}
          caption="Move"
          onPress={press}
          onRelease={release}
        />
      </div>
      <div className="absolute right-4 bottom-4">
        <Cross
          top={{ k: 'arrowup', label: '↑' }}
          row={[
            { k: 'arrowleft', label: '←' },
            { k: 'arrowdown', label: '↓' },
            { k: 'arrowright', label: '→' }
          ]}
          active={active}
          caption="Look"
          onPress={press}
          onRelease={release}
        />
      </div>
    </>
  );
}

type Key = { k: string; label: string };

function Cross({
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
      <span className="mt-1 text-[10px] tracking-wide text-white/60 uppercase drop-shadow">
        {caption}
      </span>
    </div>
  );
}

function Cap({
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
          ? 'border-white bg-white/90 text-black'
          : 'border-white/30 bg-black/40 text-white/90'
      }`}
    >
      {label}
    </button>
  );
}
