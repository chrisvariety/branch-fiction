import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import { useQuery } from '@tanstack/react-query';

import { getSavedOysterWorlds, type SavedWorld } from '@/iframe/db/worlds';
import type { OysterModel } from '@/lib/db/types';

const MODE_LABELS: Record<OysterModel, string> = {
  'oyster-adventure': 'Adventure',
  'oyster-directing': 'Director'
};

const NEW_WORLDS: { value: OysterModel; label: string; blurb: string }[] = [
  {
    value: 'oyster-directing',
    label: 'Director',
    blurb: 'Direct the scene by typing or choosing actions.'
  },
  {
    value: 'oyster-adventure',
    label: 'Adventure',
    blurb: 'You are the character. Move, look, and act your way through the world.'
  }
];

export function OysterStartStep({
  bookId,
  selected,
  onSelectNew,
  onReturn
}: {
  bookId: string;
  selected: OysterModel | null;
  onSelectNew: (model: OysterModel) => void;
  onReturn: (world: SavedWorld) => void;
}) {
  const saved = useQuery({
    queryKey: ['saved-oyster-worlds', bookId],
    queryFn: () => getSavedOysterWorlds(bookId)
  });

  const worlds = saved.data ?? [];

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      {worlds.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
            Return to a world
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {worlds.map((world) => (
              <SavedWorldCard
                key={world.worldId}
                world={world}
                onClick={() => onReturn(world)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        {worlds.length > 0 && (
          <h2 className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
            Or start fresh
          </h2>
        )}
        <div
          role="radiogroup"
          aria-label="New Happy Oyster world"
          className="grid gap-3 sm:grid-cols-2"
        >
          {NEW_WORLDS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={option.value === selected}
              onClick={() => onSelectNew(option.value)}
              className={`flex flex-col gap-2 border bg-card p-4 text-left transition-colors ${
                option.value === selected
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/40'
              }`}
            >
              <span className="font-serif text-sm">{option.label}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {option.blurb}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function SavedWorldCard({ world, onClick }: { world: SavedWorld; onClick: () => void }) {
  const subtitle = [world.characterName, world.placeName].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 border border-border bg-card p-2 text-left transition-colors hover:border-muted-foreground/40"
    >
      <img
        src={transformImageUrl(world.seedImageUrl)}
        alt=""
        className="block aspect-video w-full object-cover"
      />
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        <span className="font-serif text-sm">{subtitle || 'Saved world'}</span>
        <span className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          {MODE_LABELS[world.model]}
        </span>
      </div>
    </button>
  );
}
