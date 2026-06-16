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

// Movement axes are persistent state: each keydown sets a value, each keyup resets to idle.
export function LingbotControls({ sendCommand }: { sendCommand: SendCommand }) {
  const [active, setActive] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return (
        el?.tagName === 'INPUT' ||
        el?.tagName === 'TEXTAREA' ||
        el?.isContentEditable === true
      );
    };

    const mark = (k: string, on: boolean) =>
      setActive((prev) => {
        const next = new Set(prev);
        if (on) next.add(k);
        else next.delete(k);
        return next;
      });

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (MOVEMENT_KEYS[k]) {
        e.preventDefault();
        mark(k, true);
        void sendCommand('set_movement', { movement: MOVEMENT_KEYS[k] });
      } else if (LOOK_H_KEYS[k]) {
        e.preventDefault();
        mark(k, true);
        void sendCommand('set_look_horizontal', { look_horizontal: LOOK_H_KEYS[k] });
      } else if (LOOK_V_KEYS[k]) {
        e.preventDefault();
        mark(k, true);
        void sendCommand('set_look_vertical', { look_vertical: LOOK_V_KEYS[k] });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (MOVEMENT_KEYS[k]) {
        mark(k, false);
        void sendCommand('set_movement', { movement: 'idle' });
      } else if (LOOK_H_KEYS[k]) {
        mark(k, false);
        void sendCommand('set_look_horizontal', { look_horizontal: 'idle' });
      } else if (LOOK_V_KEYS[k]) {
        mark(k, false);
        void sendCommand('set_look_vertical', { look_vertical: 'idle' });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [sendCommand]);

  return (
    <>
      <div className="pointer-events-none absolute bottom-4 left-4">
        <Cross
          top={{ k: 'w', label: 'W' }}
          row={[
            { k: 'a', label: 'A' },
            { k: 's', label: 'S' },
            { k: 'd', label: 'D' }
          ]}
          active={active}
          caption="Move"
        />
      </div>
      <div className="pointer-events-none absolute right-4 bottom-4">
        <Cross
          top={{ k: 'arrowup', label: '↑' }}
          row={[
            { k: 'arrowleft', label: '←' },
            { k: 'arrowdown', label: '↓' },
            { k: 'arrowright', label: '→' }
          ]}
          active={active}
          caption="Look"
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
  caption
}: {
  top: Key;
  row: Key[];
  active: Set<string>;
  caption: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Cap label={top.label} on={active.has(top.k)} />
      <div className="flex gap-1">
        {row.map((key) => (
          <Cap key={key.k} label={key.label} on={active.has(key.k)} />
        ))}
      </div>
      <span className="mt-1 text-[10px] tracking-wide text-white/60 uppercase drop-shadow">
        {caption}
      </span>
    </div>
  );
}

function Cap({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`grid h-9 w-9 place-items-center rounded-md border text-sm font-medium backdrop-blur-sm transition-colors ${
        on
          ? 'border-white bg-white/90 text-black'
          : 'border-white/30 bg-black/40 text-white/90'
      }`}
    >
      {label}
    </span>
  );
}
