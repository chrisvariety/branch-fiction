import { useEffect, useState } from 'react';

import { Cross, isTypingTarget } from './KeyPad';

type SendCommand = (command: string, data: unknown) => Promise<void>;

type Longitudinal = 'idle' | 'forward' | 'back';
type Lateral = 'idle' | 'strafe_left' | 'strafe_right';
type LookH = 'idle' | 'left' | 'right';
type LookV = 'idle' | 'up' | 'down';

// World 2 splits movement into independent axes, so W/S and A/D can be held together.
const LONGITUDINAL_KEYS: Record<string, Longitudinal> = { w: 'forward', s: 'back' };
const LATERAL_KEYS: Record<string, Lateral> = { a: 'strafe_left', d: 'strafe_right' };
const LOOK_H_KEYS: Record<string, LookH> = { arrowleft: 'left', arrowright: 'right' };
const LOOK_V_KEYS: Record<string, LookV> = { arrowup: 'up', arrowdown: 'down' };

// Each key sets its axis to a value while held; releasing resets that axis to idle.
function commandFor(k: string): { command: string; field: string; value: string } | null {
  if (LONGITUDINAL_KEYS[k])
    return {
      command: 'set_move_longitudinal',
      field: 'move_longitudinal',
      value: LONGITUDINAL_KEYS[k]
    };
  if (LATERAL_KEYS[k])
    return { command: 'set_move_lateral', field: 'move_lateral', value: LATERAL_KEYS[k] };
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
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
    <div className="flex justify-between gap-4 px-4 pt-3 sm:contents">
      <div className="sm:absolute sm:bottom-4 sm:left-4">
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
      <div className="sm:absolute sm:right-4 sm:bottom-4">
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
    </div>
  );
}
