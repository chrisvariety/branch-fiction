import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import { IconCheck, IconCopy, IconDownload, IconExternalLink } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PickableCharacter } from '@/iframe/db/entities';
import { getAvatar } from '@/iframe/db/models/avatar/get-avatar';
import { setRunwayAvatarId } from '@/iframe/db/models/avatar/update-avatar';
import type { PrepareAvatarResult } from '@/worker/prepare-avatar';

const RUNWAY_CHARACTERS_URL = 'https://dev.runwayml.com/characters';
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
  onReady: (avatarId: string) => void;
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

  const ready = avatar.data && !generating;

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-10 pt-10 pb-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          {character.name}
        </p>
        <h1 className="font-serif text-xl tracking-tight text-balance">
          Create your Runway Character
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
                {status ?? 'Generating portrait and personality…'}
              </p>
            </>
          )}
        </div>
      ) : (
        <Prep
          bookId={bookId}
          character={character}
          imageUrl={avatar.data!.imageUrl}
          personality={avatar.data!.personality}
          initialAvatarId={avatar.data!.runwayAvatarId ?? ''}
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
  bookId,
  character,
  imageUrl,
  personality,
  initialAvatarId,
  regenerating,
  onRegenerate,
  onChangeStyle,
  onReady
}: {
  bookId: string;
  character: PickableCharacter;
  imageUrl: string;
  personality: string;
  initialAvatarId: string;
  regenerating: boolean;
  onRegenerate: () => void;
  onChangeStyle: () => void;
  onReady: (avatarId: string) => void;
}) {
  const [avatarId, setAvatarId] = useState(initialAvatarId);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const hostImageUrl = transformImageUrl(imageUrl);

  async function downloadImage() {
    const res = await fetch(hostImageUrl);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const filename = `${character.name.replace(/[^\w-]+/g, '_')}.png`;
    await window.extensionSDK.saveFile(filename, bytes, 'image/png');
  }

  async function copyPersonality() {
    await navigator.clipboard.writeText(personality);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function save() {
    const id = avatarId.trim();
    if (!id) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setRunwayAvatarId(bookId, character.id, id);
      onReady(id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-2">
          <img
            src={hostImageUrl}
            alt={`Reference portrait of ${character.name}`}
            className="aspect-video w-full border border-border object-cover"
          />
          <button
            type="button"
            onClick={() => void downloadImage()}
            className="flex items-center justify-center gap-2 border border-border px-3 py-2 text-sm font-medium hover:border-muted-foreground/40"
          >
            <IconDownload size={16} /> Download portrait
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Personality</span>
            <button
              type="button"
              onClick={() => void copyPersonality()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
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

      <ol className="flex flex-col gap-1.5 border-l-2 border-border pl-4 text-xs leading-relaxed text-muted-foreground">
        <li>1. Download the portrait and copy the personality above.</li>
        <li>
          2. Open Runway and click <strong>Create a Character</strong>, then upload the
          portrait.
        </li>
        <li>
          3. Paste the personality into <strong>Describe personality</strong>.
        </li>
        <li>4. Copy the new Character ID and paste it below.</li>
      </ol>

      <button
        type="button"
        onClick={() => void window.extensionSDK.openExternal(RUNWAY_CHARACTERS_URL)}
        className="flex items-center justify-center gap-2 border border-border px-3 py-2 text-sm font-medium hover:border-muted-foreground/40"
      >
        <IconExternalLink size={16} /> Open Runway Characters
      </button>

      <div className="flex flex-col gap-2">
        <label htmlFor="avatar-id" className="text-xs font-medium text-muted-foreground">
          Runway Character ID
        </label>
        <div className="flex gap-2">
          <input
            id="avatar-id"
            type="text"
            value={avatarId}
            placeholder="e.g. a1b2c3d4-…"
            onChange={(e) => setAvatarId(e.target.value)}
            className="flex-1 border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none"
          />
          <button
            type="button"
            disabled={!avatarId.trim() || saving}
            onClick={() => void save()}
            className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Starting…' : 'Start call'}
          </button>
        </div>
        {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      </div>

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
