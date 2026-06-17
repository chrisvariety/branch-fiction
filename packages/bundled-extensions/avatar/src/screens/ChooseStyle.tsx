import { useState } from 'react';

import type { PickableCharacter } from '@/iframe/db/entities';
import { ART_STYLES, artStyleImage } from '@/lib/art-styles';

function cardClasses(selected: boolean) {
  return `flex flex-col gap-2 border bg-card p-2 text-left transition-colors ${
    selected
      ? 'border-primary ring-1 ring-primary'
      : 'border-border hover:border-muted-foreground/40'
  }`;
}

export function ChooseStyle({
  character,
  onChoose,
  onBack
}: {
  character: PickableCharacter;
  onChoose: (stylePrompt: string) => void;
  onBack: () => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [custom, setCustom] = useState('');

  const stylePrompt =
    selectedId === 'custom'
      ? custom.trim()
      : (ART_STYLES.find((s) => s.id === selectedId)?.prompt ?? '');

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-10 pt-12 pb-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          {character.name}
        </p>
        <h1 className="font-serif text-xl tracking-tight text-balance">
          Choose an art style
        </h1>
        <div className="h-px w-12 bg-border" />
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          The look of the reference portrait, and the avatar it becomes.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Art style"
        className="grid w-full max-w-2xl grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3"
      >
        {ART_STYLES.map((s) => {
          const image = artStyleImage(s.id);
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selectedId === s.id}
              className={cardClasses(selectedId === s.id)}
              onClick={() => setSelectedId(s.id)}
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
          className={cardClasses(selectedId === 'custom')}
          onClick={() => setSelectedId('custom')}
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
                setCustom(e.target.value);
                setSelectedId('custom');
              }}
              onClick={(e) => e.stopPropagation()}
              className="box-border w-full border border-input bg-background px-2 py-1.5 text-foreground focus:border-ring focus:outline-none"
            />
          </div>
          <div className="text-center font-serif text-sm">Custom</div>
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="border border-border px-4 py-2 text-sm font-medium"
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          disabled={!stylePrompt}
          onClick={() => onChoose(stylePrompt)}
          className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Generate portrait
        </button>
      </div>
    </div>
  );
}
