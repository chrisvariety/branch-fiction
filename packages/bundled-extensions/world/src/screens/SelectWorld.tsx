import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getCharacters, getPlaces } from '@/iframe/db/entities';
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

  const [characterId, setCharacterId] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [model, setModel] = useState<WorldModel>('helios');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = characterId && placeId && !busy;

  async function enter() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setStatus('Preparing your world…');
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
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Explore the World</h1>
        <p className="mt-1 text-sm opacity-70">
          Pick a character and a place, choose a world model, and step inside.
        </p>
      </header>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Character</span>
        <select
          className="rounded-md border bg-transparent p-2"
          value={characterId}
          onChange={(e) => setCharacterId(e.target.value)}
        >
          <option value="">
            {characters.isLoading ? 'Loading…' : 'Select a character'}
          </option>
          {characters.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Place</span>
        <select
          className="rounded-md border bg-transparent p-2"
          value={placeId}
          onChange={(e) => setPlaceId(e.target.value)}
        >
          <option value="">{places.isLoading ? 'Loading…' : 'Select a place'}</option>
          {places.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2">
        <span className="text-sm font-medium">World model</span>
        {MODELS.map((m) => (
          <label
            key={m.value}
            className="flex cursor-pointer items-start gap-3 rounded-md border p-3"
          >
            <input
              type="radio"
              name="model"
              className="mt-1"
              checked={model === m.value}
              onChange={() => setModel(m.value)}
            />
            <span>
              <span className="block font-medium">{m.label}</span>
              <span className="block text-sm opacity-70">{m.blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <button
        className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
        disabled={!canSubmit}
        onClick={enter}
      >
        {busy ? 'Preparing…' : 'Enter the world'}
      </button>

      {status && busy && <p className="text-sm opacity-70">{status}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
