import type { ActiveWorld, OysterModel } from '@/lib/db/types';
import { isOysterModel, type ReactorSdkModel } from '@/lib/reactor';

import { OysterWorldView } from './OysterWorldView';
import { ReactorWorldView } from './ReactorWorldView';

export function WorldView({ world, onExit }: { world: ActiveWorld; onExit: () => void }) {
  if (isOysterModel(world.model)) {
    return (
      <OysterWorldView
        world={world as ActiveWorld & { model: OysterModel }}
        onExit={onExit}
      />
    );
  }
  return (
    <ReactorWorldView
      world={world as ActiveWorld & { model: ReactorSdkModel }}
      onExit={onExit}
    />
  );
}
