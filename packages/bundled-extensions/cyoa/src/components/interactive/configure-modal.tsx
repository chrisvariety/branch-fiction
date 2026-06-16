import { IconPlus, IconX } from '@tabler/icons-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

interface SelectedEntity {
  id: string;
  name: string;
  imageUrl?: string;
}

export function ConfigureModal({
  open,
  onClose,
  selectedCharacters,
  selectedPlace,
  onRemoveCharacter,
  onChangeLocation,
  onAddCharacters,
  ctaLabel,
  onCtaClick
}: {
  open: boolean;
  onClose: () => void;
  selectedCharacters: SelectedEntity[];
  selectedPlace: SelectedEntity | null;
  onRemoveCharacter: (characterId: string) => void;
  onChangeLocation: () => void;
  onAddCharacters: () => void;
  ctaLabel: string;
  onCtaClick: () => void;
}) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="absolute right-0 left-0 text-center font-sans text-sm text-foreground">
          Edit configuration
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="relative ml-auto flex h-9 w-9 items-center justify-center rounded-full p-2 shadow-md transition-colors hover:bg-muted"
          aria-label="Close"
        >
          <IconX />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4">
        <div>
          <p className="text-xs tracking-widest uppercase">Characters</p>
          <ul className="mt-2 space-y-2">
            {selectedCharacters.length > 0 ? (
              selectedCharacters.map((character, index) => (
                <EntityRow
                  key={character.id}
                  name={character.name}
                  imageUrl={character.imageUrl}
                  subtitle={
                    index === 0 ? `You're playing as ${character.name}` : undefined
                  }
                  onAction={() => onRemoveCharacter(character.id)}
                  actionLabel="Remove"
                />
              ))
            ) : (
              <EntityRow
                name="Character"
                placeholder
                onAction={onAddCharacters}
                actionLabel="Add characters"
              />
            )}
          </ul>
          {selectedCharacters.length > 0 && (
            <button
              type="button"
              onClick={onAddCharacters}
              className="relative mt-2 flex h-7.5 items-center justify-center gap-2 rounded-md px-4 text-sm shadow-md transition-colors hover:bg-muted"
              aria-label="Add more characters"
            >
              Add characters <IconPlus className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-6">
          <p className="text-xs tracking-widest uppercase">Location</p>
          <div className="mt-2">
            {selectedPlace ? (
              <EntityRow
                name={selectedPlace.name}
                imageUrl={selectedPlace.imageUrl}
                onAction={onChangeLocation}
                actionLabel="Change location"
              />
            ) : (
              <EntityRow
                name="Location"
                placeholder
                onAction={onChangeLocation}
                actionLabel="Add location"
              />
            )}
          </div>
        </div>
      </div>

      {/* Fixed bottom CTA */}
      <div className="px-4 pt-2 pb-4">
        <Button variant="primary" size="2xl" className="w-full" onClick={onCtaClick}>
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
}

function EntityRow({
  name,
  imageUrl,
  subtitle,
  placeholder,
  onAction,
  actionLabel
}: {
  name: string;
  imageUrl?: string;
  subtitle?: ReactNode;
  placeholder?: boolean;
  onAction: () => void;
  actionLabel: string;
}) {
  return (
    <li className="flex items-center gap-3 rounded-md border">
      {placeholder ? (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-l-md bg-muted text-muted-foreground">
          <IconPlus className="h-5 w-5" />
        </div>
      ) : imageUrl ? (
        <img
          src={imageUrl}
          alt={name}
          className="h-14 w-14 shrink-0 rounded-l-md object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-muted-foreground">
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="flex-1">
        <div
          className={
            placeholder
              ? 'text-sm text-muted-foreground'
              : 'text-sm font-medium text-foreground'
          }
        >
          {name}
        </div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground underline underline-offset-3 hover:bg-muted hover:text-foreground"
        onClick={onAction}
        aria-label={`${actionLabel} ${name}`}
      >
        {actionLabel}
      </Button>
    </li>
  );
}
