import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';

export function WorldBuildingLoadingOverlay({
  entities,
  text = 'Building your world…'
}: {
  entities: Array<{ id: string; name: string; imageUrl?: string }>;
  text?: string;
}) {
  const visibleEntities = entities.filter(Boolean);
  const ENTER_DURATION_MS = 650;
  const STAGGER_MS = 120;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="w-full max-w-2xl px-6 text-center">
        <div className="flex flex-col items-center gap-6">
          <div className="wb-enter flex items-end justify-center gap-3">
            {visibleEntities.map((entity, index) => {
              const imageUrl = entity.imageUrl;
              return (
                <div
                  key={entity.id}
                  className="wb-bounce"
                  style={{
                    animationDelay: `${ENTER_DURATION_MS + index * STAGGER_MS}ms`
                  }}
                >
                  {imageUrl ? (
                    <img
                      src={transformImageUrl(imageUrl, { variant: 'thumb' })}
                      alt={entity.name}
                      className="h-12 w-12 rounded-full object-cover shadow-lg ring-2 ring-white/60"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/80 text-sm font-semibold text-gray-700 shadow-lg ring-2 ring-white/60">
                      {entity.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="text-sm font-medium text-white/90">{text}</div>
        </div>
      </div>
    </div>
  );
}
