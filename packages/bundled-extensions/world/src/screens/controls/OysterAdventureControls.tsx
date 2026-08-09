import type { AdventureCommand } from '@reactor-models/happy-oyster';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Cross, isTypingTarget } from './KeyPad';

type Translation = NonNullable<AdventureCommand['translation']>;
type Rotation = NonNullable<AdventureCommand['rotation']>;

const BUILT_IN_VERBS = ['Jump', 'Attack', 'Crouch', 'Sprint'];

function dedupeVerbs(verbs: string[]): string[] {
  const seen = new Set<string>();
  return verbs.filter((verb) => {
    const key = verb.toLowerCase().replace(/_/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const MOVE_KEYS = new Set(['w', 'a', 's', 'd']);
const LOOK_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

function composeTranslation(held: Set<string>): Translation | null {
  const vertical =
    held.has('w') !== held.has('s') ? (held.has('w') ? 'Front' : 'Back') : null;
  const lateral =
    held.has('a') !== held.has('d') ? (held.has('a') ? 'Left' : 'Right') : null;
  if (vertical && lateral) return `${vertical}_${lateral}` as Translation;
  return vertical ?? lateral;
}

function composeRotation(held: Set<string>): Rotation | null {
  const vertical =
    held.has('arrowup') !== held.has('arrowdown')
      ? held.has('arrowup')
        ? 'Up'
        : 'Down'
      : null;
  const lateral =
    held.has('arrowleft') !== held.has('arrowright')
      ? held.has('arrowleft')
        ? 'Left'
        : 'Right'
      : null;
  if (vertical && lateral) return `Mouse_${vertical}_${lateral}` as Rotation;
  if (vertical) return `Mouse_${vertical}` as Rotation;
  if (lateral) return `Mouse_${lateral}` as Rotation;
  return null;
}

export function OysterAdventureControls({
  move,
  look,
  interact,
  release,
  verbs
}: {
  move: (d: Translation) => Promise<void>;
  look: (d: Rotation) => Promise<void>;
  interact: (verb: string) => Promise<void>;
  release: (axes: {
    translation?: true;
    rotation?: true;
    interaction?: true;
  }) => Promise<void>;
  verbs: string[];
}) {
  const [active, setActive] = useState<Set<string>>(() => new Set());
  const [heldVerb, setHeldVerb] = useState<string | null>(null);
  const lastSent = useRef<{ translation: Translation | null; rotation: Rotation | null }>(
    {
      translation: null,
      rotation: null
    }
  );

  useEffect(() => {
    const translation = composeTranslation(active);
    if (translation !== lastSent.current.translation) {
      lastSent.current.translation = translation;
      void (translation ? move(translation) : release({ translation: true }));
    }
    const rotation = composeRotation(active);
    if (rotation !== lastSent.current.rotation) {
      lastSent.current.rotation = rotation;
      void (rotation ? look(rotation) : release({ rotation: true }));
    }
  }, [active, move, look, release]);

  const mark = useCallback(
    (k: string, on: boolean) =>
      setActive((prev) => {
        if (prev.has(k) === on) return prev;
        const next = new Set(prev);
        if (on) next.add(k);
        else next.delete(k);
        return next;
      }),
    []
  );

  const press = useCallback((k: string) => mark(k, true), [mark]);
  const lift = useCallback((k: string) => mark(k, false), [mark]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.has(k) || LOOK_KEYS.has(k)) {
        e.preventDefault();
        mark(k, true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => mark(e.key.toLowerCase(), false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [mark]);

  const pressVerb = (verb: string) => {
    setHeldVerb(verb);
    void interact(verb);
  };

  const releaseVerb = () => {
    setHeldVerb(null);
    void release({ interaction: true });
  };

  const allVerbs = dedupeVerbs([...BUILT_IN_VERBS, ...verbs]);

  return (
    <>
      <div className="flex flex-wrap justify-center gap-1.5 px-4 pt-3 sm:absolute sm:inset-x-0 sm:bottom-20 sm:pt-0">
        {allVerbs.map((verb) => (
          <button
            key={verb}
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              pressVerb(verb);
            }}
            onPointerUp={releaseVerb}
            onPointerCancel={releaseVerb}
            className={`touch-none rounded-full border px-3 py-1 text-xs backdrop-blur-md transition-colors select-none ${
              heldVerb === verb
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {verb.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
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
            onRelease={lift}
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
            onRelease={lift}
          />
        </div>
      </div>
    </>
  );
}
