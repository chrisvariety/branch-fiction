import { useEffect, useState } from 'react';

import type { PrepareWorldResult } from '@/worker/prepare-world';

import { SelectWorld } from './screens/SelectWorld';
import { WorldView } from './screens/WorldView';

export function App() {
  const [bookId, setBookId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [world, setWorld] = useState<PrepareWorldResult | null>(null);

  useEffect(() => {
    window.extensionSDK.onReady((ctx) => {
      setBookId(ctx.bookId);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div className="grid h-screen place-items-center text-sm opacity-70">Loading…</div>
    );
  }

  if (!bookId) {
    return (
      <div className="grid h-screen place-items-center p-8 text-center text-sm opacity-70">
        Open this extension from a book to explore its world.
      </div>
    );
  }

  if (world) {
    return <WorldView world={world} onExit={() => setWorld(null)} />;
  }

  return <SelectWorld bookId={bookId} onPrepared={setWorld} />;
}
