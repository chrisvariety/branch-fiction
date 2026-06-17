import { AvatarCall, AvatarVideo, ControlBar } from '@runwayml/avatars-react';
import { useState } from 'react';

import { connectAvatarSession, RUNWAY_API_BASE } from '@/lib/runway';

export function AvatarView({
  avatarId,
  onExit
}: {
  avatarId: string;
  onExit: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 p-3 pt-5">
      <div className="relative flex-1 overflow-hidden rounded-2xl bg-black">
        {error ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="flex max-w-sm flex-col gap-3">
              <p className="text-sm text-red-400">{error}</p>
              <button
                type="button"
                onClick={onExit}
                className="rounded-full border border-white/30 px-4 py-1.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
              >
                Back to characters
              </button>
            </div>
          </div>
        ) : (
          <AvatarCall
            key={avatarId}
            avatarId={avatarId}
            connect={connectAvatarSession}
            baseUrl={RUNWAY_API_BASE}
            video={false}
            onEnd={onExit}
            onError={(e) => setError(e.message)}
            className="h-full w-full"
          >
            <AvatarVideo />
            <ControlBar showCamera={false} />
          </AvatarCall>
        )}
      </div>
    </div>
  );
}
