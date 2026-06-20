import { useQuery } from '@tanstack/react-query';

import { getCharacters, type PickableCharacter } from '@/iframe/db/entities';

export function SelectCharacter({
  bookId,
  onSelect
}: {
  bookId: string;
  onSelect: (character: PickableCharacter) => void;
}) {
  const characters = useQuery({
    queryKey: ['characters', bookId],
    queryFn: () => getCharacters(bookId)
  });

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-10 pt-12 pb-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          Step one
        </p>
        <h1 className="font-serif text-xl tracking-tight text-balance">
          Choose a character
        </h1>
        <div className="h-px w-12 bg-border" />
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          Who you'll bring to life as a real-time avatar.
        </p>
      </div>

      {characters.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : characters.data && characters.data.length > 0 ? (
        <div className="grid w-full max-w-2xl grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {characters.data.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c)}
              className="flex flex-col gap-1 border border-border bg-card p-3 text-left transition-colors hover:border-muted-foreground/40"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-serif text-sm">{c.name}</span>
                {c.runwayAvatarId ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] tracking-wide text-primary uppercase">
                    Ready
                  </span>
                ) : c.hasAvatar ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] tracking-wide text-muted-foreground uppercase">
                    Prepped
                  </span>
                ) : null}
              </span>
              {c.identityTag && (
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {c.identityTag}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="max-w-sm text-center text-xs text-muted-foreground">
          No characters with a personality arc are available for this book yet.
        </p>
      )}
    </div>
  );
}
