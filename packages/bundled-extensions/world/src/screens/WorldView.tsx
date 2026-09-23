import type { ActiveWorld } from '@/lib/db/types';

import { ReactorWorldView } from './ReactorWorldView';

export function WorldView({ world, onExit }: { world: ActiveWorld; onExit: () => void }) {
  return <ReactorWorldView world={world} onExit={onExit} />;
}
