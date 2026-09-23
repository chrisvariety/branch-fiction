import { useEffect, useRef, useState } from 'react';

import type { WorldModel } from '@/lib/db/types';

const MODELS: { value: WorldModel; label: string; blurb: string }[] = [
  {
    value: 'helios',
    label: 'Helios',
    blurb: 'Prompt-steered cinematic stream. Evolve the scene by typing new beats.'
  },
  {
    value: 'lingbot',
    label: 'LingBot',
    blurb: 'Walkable world. Move with WASD and look with the arrow keys.'
  }
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// A CSS 3D cube whose front face is marked so its facing direction reads at a glance.
function Cube({ rotation }: { rotation: number }) {
  const half = 30;
  const faces: { transform: string; className: string; content?: string }[] = [
    {
      transform: `translateZ(${half}px)`,
      className: 'bg-primary/85 text-primary-foreground',
      content: '◳'
    },
    { transform: `rotateY(180deg) translateZ(${half}px)`, className: 'bg-foreground/15' },
    { transform: `rotateY(90deg) translateZ(${half}px)`, className: 'bg-foreground/25' },
    { transform: `rotateY(-90deg) translateZ(${half}px)`, className: 'bg-foreground/20' },
    { transform: `rotateX(90deg) translateZ(${half}px)`, className: 'bg-foreground/30' },
    { transform: `rotateX(-90deg) translateZ(${half}px)`, className: 'bg-foreground/10' }
  ];
  return (
    <div className="[perspective:600px]">
      <div
        className="relative h-[60px] w-[60px] transition-transform duration-700 ease-in-out [transform-style:preserve-3d]"
        style={{ transform: `rotateX(-18deg) rotateY(${rotation}deg)` }}
      >
        {faces.map((f) => (
          <div
            key={f.transform}
            className={`absolute inset-0 grid place-items-center border border-foreground/20 text-lg ${f.className}`}
            style={{ transform: f.transform }}
          >
            {f.content}
          </div>
        ))}
      </div>
    </div>
  );
}

const HELIOS_PROMPT = 'turn around';

function HeliosPreview() {
  const reduced = usePrefersReducedMotion();
  const [rotation, setRotation] = useState(0);
  const [text, setText] = useState(reduced ? HELIOS_PROMPT : '');

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    async function run() {
      while (!cancelled) {
        for (let i = 1; i <= HELIOS_PROMPT.length; i++) {
          if (cancelled) return;
          setText(HELIOS_PROMPT.slice(0, i));
          await wait(70);
        }
        await wait(650);
        if (cancelled) return;
        setRotation((r) => r + 180);
        await wait(1700);
        if (cancelled) return;
        setText('');
        await wait(500);
      }
    }

    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reduced]);

  return (
    <div className="flex h-44 flex-col items-center justify-between py-4">
      <div className="flex flex-1 items-center">
        <Cube rotation={rotation} />
      </div>
      <div className="flex w-full max-w-[200px] items-center gap-2 rounded-full border border-border bg-background/60 py-1 pr-1 pl-3">
        <span className="flex-1 truncate font-mono text-xs text-foreground">
          {text}
          <span className="ml-px inline-block w-px animate-pulse">|</span>
        </span>
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-foreground/60">
          →
        </span>
      </div>
    </div>
  );
}

type Pressed = 'left' | 'right' | null;

const LING_SEQUENCE: Exclude<Pressed, null>[] = ['right', 'right', 'left', 'left'];

function LingbotPreview() {
  const reduced = usePrefersReducedMotion();
  const [rotation, setRotation] = useState(0);
  const [pressed, setPressed] = useState<Pressed>(null);
  const stepRef = useRef(0);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    async function run() {
      await wait(700);
      while (!cancelled) {
        const dir = LING_SEQUENCE[stepRef.current % LING_SEQUENCE.length];
        stepRef.current += 1;
        setPressed(dir);
        setRotation((r) => r + (dir === 'right' ? 90 : -90));
        await wait(750);
        if (cancelled) return;
        setPressed(null);
        await wait(550);
      }
    }

    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reduced]);

  return (
    <div className="flex h-44 flex-col items-center justify-between py-4">
      <div className="flex flex-1 items-center">
        <Cube rotation={rotation} />
      </div>
      <div className="flex gap-1">
        <ArrowKey label="←" on={pressed === 'left'} />
        <ArrowKey label="↓" on={false} />
        <ArrowKey label="→" on={pressed === 'right'} />
      </div>
    </div>
  );
}

function ArrowKey({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`grid h-7 w-7 place-items-center rounded-md border text-sm transition-colors ${
        on
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background/60 text-foreground/70'
      }`}
    >
      {label}
    </span>
  );
}

export function ModelStep({
  model,
  onSelect
}: {
  model: WorldModel;
  onSelect: (model: WorldModel) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="World model"
      className="grid w-full max-w-2xl gap-3 sm:grid-cols-2"
    >
      {MODELS.map((m) => {
        const selected = m.value === model;
        return (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(m.value)}
            className={`flex flex-col items-center gap-2 overflow-hidden border bg-card p-3 text-center transition-colors ${
              selected
                ? 'border-primary ring-1 ring-primary'
                : 'border-border hover:border-muted-foreground/40'
            }`}
          >
            {m.value === 'helios' ? <HeliosPreview /> : <LingbotPreview />}
            <span className="font-serif text-sm">{m.label}</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              {m.blurb}
            </span>
          </button>
        );
      })}
    </div>
  );
}
