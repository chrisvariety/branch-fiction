import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getCharacters, getPlaces, type PickableEntity } from '@/iframe/db/entities';
import type { WorldModel } from '@/lib/db/types';
import type { PrepareWorldPayload, PrepareWorldResult } from '@/worker/prepare-world';

const ART_STYLE_IMAGES = import.meta.glob('./art-styles/*.png', {
  eager: true,
  import: 'default'
}) as Record<string, string>;

const ART_STYLES: { id: string; label: string; prompt: string }[] = [
  {
    id: 'digital-illustration',
    label: 'Digital Illustration',
    prompt: 'polished, semi-realistic digital illustration style (not photorealistic)'
  },
  {
    id: 'studio-ghibli',
    label: 'Studio Ghibli',
    prompt:
      'Studio Ghibli-inspired hand-painted anime style with soft painterly backgrounds, lush nature, gentle linework, and warm nostalgic light'
  },
  {
    id: 'photorealistic',
    label: 'Photorealistic',
    prompt: 'photorealistic, cinematic style with natural lighting and lifelike detail'
  },
  {
    id: 'anime',
    label: 'Anime',
    prompt:
      'modern anime style with crisp cel-shaded linework, vibrant colors, and expressive characters'
  },
  {
    id: 'oil-painting',
    label: 'Oil Painting',
    prompt:
      'classical oil painting style with visible brushwork, rich impasto texture, and dramatic chiaroscuro lighting'
  },
  {
    id: 'watercolor',
    label: 'Watercolor',
    prompt:
      'soft watercolor painting style with delicate washes, bleeding pigments, and a light airy feel'
  },
  {
    id: 'comic-book',
    label: 'Comic Book',
    prompt:
      'bold comic book and graphic-novel style with heavy ink outlines, dynamic shading, and saturated flat colors'
  },
  {
    id: 'storybook',
    label: 'Storybook',
    prompt:
      "whimsical children's storybook illustration style with gentle textures, hand-drawn charm, and warm inviting colors"
  },
  {
    id: 'stylized-3d',
    label: 'Stylized 3D',
    prompt:
      'stylized 3D animated film style with smooth rounded forms, soft global illumination, and expressive character design'
  },
  {
    id: 'dark-fantasy',
    label: 'Dark Fantasy',
    prompt:
      'dark painterly fantasy concept-art style with moody atmosphere, dramatic lighting, and richly detailed environments'
  }
];

function artImage(id: string): string | undefined {
  return ART_STYLE_IMAGES[`./art-styles/${id}.png`];
}

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

const STEPS = [
  {
    eyebrow: 'Step one',
    title: 'Choose a character',
    description: 'Who you will explore the world as.'
  },
  {
    eyebrow: 'Step two',
    title: 'Choose a place',
    description: 'Where the scene unfolds around them.'
  },
  {
    eyebrow: 'Step three',
    title: 'Choose an art style',
    description: 'The look for the generated world.'
  },
  {
    eyebrow: 'Step four',
    title: 'Choose a world model',
    description: 'How you will steer and move through the world.'
  }
];

interface Choice {
  id: string;
  title: string;
  subtitle: string | null;
}

function entityChoices(entities: PickableEntity[] | undefined): Choice[] {
  return (entities ?? []).map((e) => ({
    id: e.id,
    title: e.name,
    subtitle: e.identityTag
  }));
}

function ChoiceGrid({
  label,
  loading,
  choices,
  selectedId,
  onSelect
}: {
  label: string;
  loading: boolean;
  choices: Choice[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (loading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (choices.length === 0)
    return <p className="text-xs text-muted-foreground">Nothing available.</p>;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid w-full max-w-2xl grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3"
    >
      {choices.map((c) => {
        const selected = c.id === selectedId;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(c.id)}
            className={`flex flex-col gap-1 border bg-card p-3 text-left transition-colors ${
              selected
                ? 'border-primary ring-1 ring-primary'
                : 'border-border hover:border-muted-foreground/40'
            }`}
          >
            <span className="font-serif text-sm">{c.title}</span>
            {c.subtitle && (
              <span className="text-xs leading-relaxed text-muted-foreground">
                {c.subtitle}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function artCardClasses(selected: boolean) {
  return `flex flex-col gap-2 border bg-card p-2 text-left transition-colors ${
    selected
      ? 'border-primary ring-1 ring-primary'
      : 'border-border hover:border-muted-foreground/40'
  }`;
}

function ArtStyleStep({
  selectedId,
  custom,
  onSelect,
  onCustom
}: {
  selectedId: string;
  custom: string;
  onSelect: (id: string) => void;
  onCustom: (v: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Art style"
      className="grid w-full max-w-2xl grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3"
    >
      {ART_STYLES.map((s) => {
        const image = artImage(s.id);
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={selectedId === s.id}
            className={artCardClasses(selectedId === s.id)}
            onClick={() => onSelect(s.id)}
          >
            {image ? (
              <img
                src={image}
                alt=""
                className="block aspect-square w-full object-cover"
              />
            ) : (
              <div className="aspect-square w-full bg-muted" />
            )}
            <div className="text-center font-serif text-sm">{s.label}</div>
          </button>
        );
      })}
      <button
        type="button"
        role="radio"
        aria-checked={selectedId === 'custom'}
        className={artCardClasses(selectedId === 'custom')}
        onClick={() => onSelect('custom')}
      >
        <div className="box-border flex aspect-square w-full flex-col items-center justify-center gap-2 bg-muted p-3">
          <div className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
            Custom
          </div>
          <input
            type="text"
            placeholder="Describe your style…"
            value={custom}
            onChange={(e) => {
              onCustom(e.target.value);
              onSelect('custom');
            }}
            onClick={(e) => e.stopPropagation()}
            className="box-border w-full border border-input bg-background px-2 py-1.5 text-foreground focus:border-ring focus:outline-none"
          />
        </div>
        <div className="text-center font-serif text-sm">Custom</div>
      </button>
    </div>
  );
}

export function SelectWorld({
  bookId,
  onPrepared
}: {
  bookId: string;
  onPrepared: (world: PrepareWorldResult) => void;
}) {
  const characters = useQuery({
    queryKey: ['characters', bookId],
    queryFn: () => getCharacters(bookId)
  });
  const places = useQuery({
    queryKey: ['places', bookId],
    queryFn: () => getPlaces(bookId)
  });

  const [step, setStep] = useState(0);
  const [characterId, setCharacterId] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [artStyleId, setArtStyleId] = useState('');
  const [customStyle, setCustomStyle] = useState('');
  const [model, setModel] = useState<WorldModel>('helios');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const artStyle =
    artStyleId === 'custom'
      ? customStyle.trim()
      : (ART_STYLES.find((s) => s.id === artStyleId)?.prompt ?? '');

  const canSubmit = characterId && placeId && artStyle && !busy;
  const stepReady = [Boolean(characterId), Boolean(placeId), Boolean(artStyle), true][
    step
  ];
  const isLastStep = step === 3;

  async function enter() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const payload: PrepareWorldPayload = { characterId, placeId, model, artStyle };
      const result = await window.extensionSDK.worker
        .spawn<PrepareWorldResult>('prepareWorld', payload)
        .onLog((args) => setStatus(args.map(String).join(' ')));
      onPrepared(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const current = STEPS[step];

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-10 pt-12 pb-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          {current.eyebrow}
        </p>
        <h1 className="font-serif text-xl tracking-tight text-balance">
          {current.title}
        </h1>
        <div className="h-px w-12 bg-border" />
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          {current.description}
        </p>
      </div>

      {step === 0 && (
        <ChoiceGrid
          label={current.title}
          loading={characters.isLoading}
          choices={entityChoices(characters.data)}
          selectedId={characterId}
          onSelect={setCharacterId}
        />
      )}

      {step === 1 && (
        <ChoiceGrid
          label={current.title}
          loading={places.isLoading}
          choices={entityChoices(places.data)}
          selectedId={placeId}
          onSelect={setPlaceId}
        />
      )}

      {step === 2 && (
        <ArtStyleStep
          selectedId={artStyleId}
          custom={customStyle}
          onSelect={setArtStyleId}
          onCustom={setCustomStyle}
        />
      )}

      {step === 3 && (
        <ChoiceGrid
          label={current.title}
          loading={false}
          choices={MODELS.map((m) => ({
            id: m.value,
            title: m.label,
            subtitle: m.blurb
          }))}
          selectedId={model}
          onSelect={(id) => setModel(id as WorldModel)}
        />
      )}

      <div className="flex flex-col items-center gap-2">
        <div className="flex gap-2">
          {step > 0 && (
            <button
              type="button"
              className="border border-border px-4 py-2 text-sm font-medium disabled:opacity-40"
              disabled={busy}
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={isLastStep ? !canSubmit : !stepReady}
            onClick={() => (isLastStep ? void enter() : setStep((s) => s + 1))}
          >
            {isLastStep ? (busy ? 'Preparing…' : 'Enter the world') : 'Continue'}
          </button>
        </div>
        {status && busy && <p className="text-xs text-muted-foreground">{status}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
