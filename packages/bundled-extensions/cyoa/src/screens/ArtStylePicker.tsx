import { useState } from 'react';

import { cn } from '@/lib/utils';

import digitalIllustrationUrl from './digital-illustration.png';
import photorealisticUrl from './photorealistic.png';

type Choice = 'digital-illustration' | 'photorealistic' | 'custom';

const PRESET_STYLES: Record<Exclude<Choice, 'custom'>, string> = {
  'digital-illustration':
    'polished, semi-realistic digital illustration style (not photorealistic)',
  photorealistic: 'Photorealistic style'
};

type Props = { onContinue: (artStyle: string) => Promise<void> | void };

function cardClasses(selected: boolean) {
  return cn(
    'flex cursor-pointer flex-col gap-2 border bg-card p-2 text-left transition-colors',
    selected
      ? 'border-primary ring-1 ring-primary'
      : 'border-border hover:border-muted-foreground/40'
  );
}

export function ArtStylePicker({ onContinue }: Props) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);

  const resolvedStyle =
    choice === 'custom' ? custom.trim() : choice ? PRESET_STYLES[choice] : '';
  const canContinue = resolvedStyle.length > 0 && !saving;

  const handleContinue = async () => {
    if (!canContinue) return;
    setSaving(true);
    try {
      await onContinue(resolvedStyle);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-10 pt-12 pb-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          Step one
        </p>
        <h1 className="font-serif text-xl tracking-tight text-balance">
          Choose an art style
        </h1>
        <div className="h-px w-12 bg-border" />
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          The look for generated reference images and interactives.
        </p>
      </div>

      <div className="grid w-full max-w-2xl grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        <button
          type="button"
          className={cardClasses(choice === 'digital-illustration')}
          onClick={() => setChoice('digital-illustration')}
        >
          <img
            src={digitalIllustrationUrl}
            alt=""
            className="block aspect-square w-full object-cover"
          />
          <div className="text-center font-serif text-sm">Digital Illustration</div>
        </button>
        <button
          type="button"
          className={cardClasses(choice === 'photorealistic')}
          onClick={() => setChoice('photorealistic')}
        >
          <img
            src={photorealisticUrl}
            alt=""
            className="block aspect-square w-full object-cover"
          />
          <div className="text-center font-serif text-sm">Photorealistic</div>
        </button>
        <button
          type="button"
          className={cardClasses(choice === 'custom')}
          onClick={() => setChoice('custom')}
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
                setChoice('custom');
              }}
              onClick={(e) => e.stopPropagation()}
              className="box-border w-full border border-input bg-background px-2 py-1.5 text-foreground focus:border-ring focus:outline-none"
            />
          </div>
          <div className="text-center font-serif text-sm">Custom</div>
        </button>
      </div>

      <button
        type="button"
        onClick={handleContinue}
        disabled={!canContinue}
        className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Continue'}
      </button>
    </div>
  );
}
