import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PickableCharacter } from '@/iframe/db/entities';
import { getAvatar } from '@/iframe/db/models/avatar/get-avatar';
import type { PrepareAvatarResult } from '@/worker/prepare-avatar';

const PERSONALITY_MAX_CHARS = 10_000;

export function PrepareAvatar({
  bookId,
  character,
  generateWith,
  onReady,
  onBack,
  onChangeStyle
}: {
  bookId: string;
  character: PickableCharacter;
  generateWith?: string;
  onReady: () => void;
  onBack: () => void;
  onChangeStyle: () => void;
}) {
  const avatar = useQuery({
    queryKey: ['avatar', bookId, character.id],
    queryFn: () => getAvatar(bookId, character.id)
  });

  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranWith = useRef<string | null>(null);

  const runPrepare = useCallback(
    async (artStyle: string) => {
      setGenerating(true);
      setError(null);
      setStatus('Reading the character’s arcs…');
      try {
        await window.extensionSDK.worker
          .spawn<PrepareAvatarResult>(
            'prepareAvatar',
            { characterId: character.id, artStyle },
            { singletonKey: `prepareAvatar:${character.id}` }
          )
          .onLog((args) => setStatus(args.map(String).join(' ')));
        await avatar.refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setGenerating(false);
      }
    },
    [character.id, avatar]
  );

  useEffect(() => {
    if (!generateWith || generating) return;
    if (ranWith.current === generateWith) return;
    ranWith.current = generateWith;
    void runPrepare(generateWith);
  }, [generateWith, generating, runPrepare]);

  const ready = !!avatar.data?.imageUrl && !generating;

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-10 pt-10 pb-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          {character.name}
        </p>
        <h1 className="font-serif text-xl tracking-tight text-balance">
          Bring {character.name} to life
        </h1>
        <div className="h-px w-12 bg-border" />
      </div>

      {!ready ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          {error ? (
            <>
              <p className="max-w-sm text-xs text-destructive">{error}</p>
              <button
                type="button"
                className="border border-border px-4 py-2 text-sm font-medium"
                onClick={() => {
                  const style = generateWith ?? avatar.data?.artStyle;
                  if (style) void runPrepare(style);
                  else onChangeStyle();
                }}
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <Spinner />
              <p className="text-xs text-muted-foreground">
                {status ?? 'Generating portrait, personality, and avatar…'}
              </p>
            </>
          )}
        </div>
      ) : (
        <Prep
          character={character}
          imageUrl={avatar.data!.imageUrl}
          personality={avatar.data!.personality}
          regenerating={generating}
          onRegenerate={() => {
            const style = avatar.data?.artStyle;
            if (style) void runPrepare(style);
            else onChangeStyle();
          }}
          onChangeStyle={onChangeStyle}
          onReady={onReady}
        />
      )}

      <button
        type="button"
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        onClick={onBack}
      >
        ← Back to characters
      </button>
    </div>
  );
}

function Prep({
  character,
  imageUrl,
  personality,
  regenerating,
  onRegenerate,
  onChangeStyle,
  onReady
}: {
  character: PickableCharacter;
  imageUrl: string;
  personality: string;
  regenerating: boolean;
  onRegenerate: () => void;
  onChangeStyle: () => void;
  onReady: () => void;
}) {
  const hostImageUrl = transformImageUrl(imageUrl);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
        <img
          src={hostImageUrl}
          alt={`Reference portrait of ${character.name}`}
          className="aspect-video w-full border border-border object-cover"
        />

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Personality</span>
          <textarea
            readOnly
            value={personality}
            className="h-56 w-full resize-none border border-border bg-card p-3 text-xs leading-relaxed text-foreground focus:outline-none"
          />
          <span className="text-right text-[10px] text-muted-foreground">
            {personality.length} / {PERSONALITY_MAX_CHARS}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onReady}
        className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Start conversation
      </button>

      <div className="flex gap-4">
        <button
          type="button"
          disabled={regenerating}
          onClick={onRegenerate}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
        >
          Regenerate portrait & personality
        </button>
        <button
          type="button"
          disabled={regenerating}
          onClick={onChangeStyle}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
        >
          Change art style
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
  );
}
