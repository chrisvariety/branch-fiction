import { IconLoader2 } from '@tabler/icons-react';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import type { FirstLaunchStep } from '@/lib/db/types';
import { ensureSchema } from '@/lib/schema';

import { router } from './router';

type Phase = { kind: 'loading' } | { kind: 'ready'; ctx: ExtensionCtx };

type BookCtx = ExtensionCtx & { bookId: string };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    window.extensionSDK.onReady(async (ctx) => {
      try {
        await ensureSchema(window.extensionSDK.db);
        setPhase({ kind: 'ready', ctx });
      } catch (err) {
        console.error('[chat] init failed', err);
      }
    });
  }, []);

  if (phase.kind === 'loading') {
    return <CenteredLoader />;
  }

  if (phase.ctx.bookId === null) {
    return <CenteredNote>Open this path from a book on the main page.</CenteredNote>;
  }

  return <RouterProvider router={router} context={{ ctx: phase.ctx as BookCtx }} />;
}

function CenteredLoader() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center">
      <p className="max-w-sm font-serif text-sm text-muted-foreground italic">
        {children}
      </p>
    </div>
  );
}

export type { FirstLaunchStep };
