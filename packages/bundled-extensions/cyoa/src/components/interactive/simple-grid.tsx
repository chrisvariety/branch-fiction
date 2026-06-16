import clsx from 'clsx';

import { Button } from '@/components/ui/button';
import { transformImageUrl } from '@/lib/media/transform-url';

export function SimpleEntityGrid({
  entities,
  selectedEntityIds,
  playerEntityId,
  onToggle,
  emptyLabel
}: {
  entities: {
    id: string;
    bookEntity: {
      id: string;
      name: string;
      identityTag: string | null;
      significanceRank: number | null;
      imageUrl: string | null;
    } | null;
  }[];
  selectedEntityIds: Set<string>;
  playerEntityId?: string | null;
  onToggle: (entity: { id: string; name: string; imageUrl?: string }) => void;
  emptyLabel: string;
}) {
  const items = entities.filter((e) => e.bookEntity);

  if (items.length === 0) {
    return (
      <div className="flex h-full min-h-[60svh] items-center justify-center px-4">
        <p className="text-sm text-white/60">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="h-full max-h-[calc(100svh-2.5rem)] w-full overflow-y-auto px-3 pt-16 pb-32 md:max-h-[calc(100vh-4rem)] md:px-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {items.map((entity) => {
          const bookEntity = entity.bookEntity!;
          const selected = selectedEntityIds.has(entity.id);
          const isPlayer = playerEntityId === entity.id;
          const imageUrl = bookEntity.imageUrl
            ? transformImageUrl(bookEntity.imageUrl)
            : null;
          const handleToggle = () =>
            onToggle({
              id: entity.id,
              name: bookEntity.name,
              imageUrl: bookEntity.imageUrl ?? undefined
            });
          return (
            <div
              key={entity.id}
              role="button"
              tabIndex={0}
              onClick={handleToggle}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleToggle();
                }
              }}
              className={clsx(
                'group flex cursor-pointer flex-col overflow-hidden rounded-xl bg-white text-left shadow-lg transition-transform',
                'hover:scale-[1.01] active:scale-[0.99]',
                selected && 'ring-2 ring-white'
              )}
            >
              <div className="relative aspect-square w-full bg-gray-200">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt=""
                    aria-hidden="true"
                    className="block h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                    No image
                  </div>
                )}
                {isPlayer && (
                  <span className="absolute top-2 left-2 rounded-full bg-zinc-900/90 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
                    You're playing as
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <div className="line-clamp-2 text-sm font-semibold text-gray-900">
                  {bookEntity.name}
                </div>
                {bookEntity.identityTag && (
                  <div className="line-clamp-2 text-xs text-gray-700">
                    {bookEntity.identityTag}
                  </div>
                )}
                <div className="mt-2">
                  <Button
                    variant={selected ? 'outline-primary' : 'primary'}
                    size="sm"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle();
                    }}
                  >
                    {selected ? 'Selected' : 'Select'}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
