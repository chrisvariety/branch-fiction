import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getCharacters, getPlaces, type PickableEntity } from '@/iframe/db/entities';
import type { WorldModel } from '@/lib/db/types';
import type { PrepareWorldPayload, PrepareWorldResult } from '@/worker/prepare-world';

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
  title,
  loading,
  choices,
  selectedId,
  onSelect
}: {
  title: string;
  loading: boolean;
  choices: Choice[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-wide uppercase opacity-60">
        {title}
      </h2>
      {loading ? (
        <p className="text-sm opacity-60">Loading…</p>
      ) : choices.length === 0 ? (
        <p className="text-sm opacity-60">Nothing available.</p>
      ) : (
        <div
          role="radiogroup"
          aria-label={title}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          {choices.map((c) => {
            const selected = c.id === selectedId;
            return (
              <button
                key={c.id}
                role="radio"
                aria-checked={selected}
                onClick={() => onSelect(c.id)}
                className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors ${
                  selected
                    ? 'border-black bg-black/5 dark:border-white dark:bg-white/10'
                    : 'border-black/15 hover:border-black/40 dark:border-white/15 dark:hover:border-white/40'
                }`}
              >
                <span className="font-medium">{c.title}</span>
                {c.subtitle && <span className="text-sm opacity-60">{c.subtitle}</span>}
              </button>
            );
          })}
        </div>
      )}
    </section>
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
  const [model, setModel] = useState<WorldModel>('helios');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = characterId && placeId && !busy;
  const stepReady = [Boolean(characterId), Boolean(placeId), true][step];
  const isLastStep = step === 2;

  async function enter() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const payload: PrepareWorldPayload = { characterId, placeId, model };
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

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Explore the World</h1>
        <div
          className="flex gap-1.5"
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={3}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-0.5 flex-1 rounded-full transition-colors ${
                i <= step ? 'bg-black dark:bg-white' : 'bg-black/15 dark:bg-white/15'
              }`}
            />
          ))}
        </div>
      </header>

      {step === 0 && (
        <ChoiceGrid
          title="Select character"
          loading={characters.isLoading}
          choices={entityChoices(characters.data)}
          selectedId={characterId}
          onSelect={setCharacterId}
        />
      )}

      {step === 1 && (
        <ChoiceGrid
          title="Select place"
          loading={places.isLoading}
          choices={entityChoices(places.data)}
          selectedId={placeId}
          onSelect={setPlaceId}
        />
      )}

      {step === 2 && (
        <ChoiceGrid
          title="Select world model"
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

      <div className="sticky bottom-0 flex flex-col gap-2 bg-gradient-to-t from-white via-white pt-2 pb-1 dark:from-neutral-950 dark:via-neutral-950">
        <div className="flex gap-2">
          {step > 0 && (
            <button
              className="rounded-md border px-4 py-2 font-medium disabled:opacity-40"
              disabled={busy}
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </button>
          )}
          <button
            className="flex-1 rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
            disabled={isLastStep ? !canSubmit : !stepReady}
            onClick={() => (isLastStep ? void enter() : setStep((s) => s + 1))}
          >
            {isLastStep ? (busy ? 'Preparing…' : 'Enter the world') : 'Continue'}
          </button>
        </div>
        {status && busy && <p className="text-sm opacity-70">{status}</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
