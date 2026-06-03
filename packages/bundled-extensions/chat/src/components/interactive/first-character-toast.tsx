import { IconX } from '@tabler/icons-react';

import { transformImageUrl } from '@/lib/media/transform-url';

export function FirstCharacterToast({
  character,
  onPickSomeoneElse,
  onAddCharacters,
  onDismiss
}: {
  character: { name: string; imageUrl?: string | null };
  onPickSomeoneElse: () => void;
  onAddCharacters: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      data-gesture-ignore="true"
      onClick={(e) => e.stopPropagation()}
      className="pointer-events-auto relative w-full rounded-xl bg-zinc-900 px-4 py-3 text-white"
    >
      <button
        type="button"
        className="absolute top-3 right-3 flex items-center justify-center text-white hover:text-gray-300"
        onClick={onDismiss}
      >
        <IconX className="h-4 w-4" />
      </button>
      <div className="flex gap-3">
        {character.imageUrl && (
          <img
            src={transformImageUrl(character.imageUrl)}
            alt={character.name}
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
        )}
        <div>
          <p className="mb-2 text-sm font-semibold text-white">
            You'll be {character.name}.
          </p>
          <p className="text-sm text-gray-100">Who else are you playing with?</p>
          <div className="mt-1 flex items-center gap-1 text-sm">
            <button
              type="button"
              className="text-gray-400 underline underline-offset-2 hover:text-white"
              onClick={onPickSomeoneElse}
            >
              Undo
            </button>
            <span className="text-gray-600">&middot;</span>
            <button
              type="button"
              className="flex items-center gap-1 font-semibold text-white underline underline-offset-2 hover:text-gray-300"
              onClick={onAddCharacters}
            >
              Add someone
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
