import { useEffect } from 'react';

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
      if (MOVEMENT_KEYS[k]) {
        e.preventDefault();
        void sendCommand('set_movement', { movement: MOVEMENT_KEYS[k] });
      } else if (LOOK_H_KEYS[k]) {
        e.preventDefault();
        void sendCommand('set_look_horizontal', { look_horizontal: LOOK_H_KEYS[k] });
      } else if (LOOK_V_KEYS[k]) {
        e.preventDefault();
        void sendCommand('set_look_vertical', { look_vertical: LOOK_V_KEYS[k] });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (MOVEMENT_KEYS[k]) void sendCommand('set_movement', { movement: 'idle' });
      else if (LOOK_H_KEYS[k])
        void sendCommand('set_look_horizontal', { look_horizontal: 'idle' });
      else if (LOOK_V_KEYS[k])
        void sendCommand('set_look_vertical', { look_vertical: 'idle' });
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [sendCommand]);

  return (
    <div className="flex items-center justify-center gap-6 border-t p-3 text-xs opacity-70">
      <span>
        <kbd className="rounded border px-1">W</kbd>
        <kbd className="rounded border px-1">A</kbd>
        <kbd className="rounded border px-1">S</kbd>
        <kbd className="rounded border px-1">D</kbd> move
      </span>
      <span>
        <kbd className="rounded border px-1">←↑↓→</kbd> look around
      </span>
    </div>
  );
}
