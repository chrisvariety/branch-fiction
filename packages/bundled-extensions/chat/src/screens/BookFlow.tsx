import { isTaskAlreadyRunningError } from '@branch-fiction/extension-sdk';
import { IconAlertTriangle, IconLoader2 } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useEffect, useRef, useState } from 'react';

import { getPrimaryCastIdsByBookId } from '@/iframe/db/models/book-entity/get-primary-cast-ids';
import { upsertBookSettingsArtStyle } from '@/iframe/db/models/book-settings/create-book-settings';
import { getBookSettings } from '@/iframe/db/models/book-settings/get-book-settings';
import { getFirstLaunchStepsByBookId } from '@/iframe/db/models/first-launch-step/get-first-launch-step';
import type { BookSettings } from '@/lib/db/types';
import { overallStatus } from '@/lib/first-launch-status';

import { ArtStylePicker } from './ArtStylePicker';
import { FirstLaunch } from './FirstLaunch';
import { InteractivePicker } from './InteractivePicker';

type BookCtx = ExtensionCtx & { bookId: string };

export function BookFlow({ ctx }: { ctx: BookCtx }) {
  const [settings, setSettings] = useState<BookSettings | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void getBookSettings(ctx.bookId).then((s) => {
      if (!cancelled) setSettings(s);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx.bookId]);

  if (settings === undefined) {
    return <CenteredLoader />;
  }

  if (settings === null) {
    return (
      <ArtStylePicker
        onContinue={async (artStyle) => {
          await upsertBookSettingsArtStyle(ctx.bookId, artStyle);
          setSettings({
            bookId: ctx.bookId,
            artStyle,
            characterInteractiveType: null,
            placeInteractiveType: null,
            createdAt: '',
            updatedAt: ''
          });
        }}
      />
    );
  }

  return <FirstLaunchGate ctx={ctx} />;
}

function FirstLaunchGate({ ctx }: { ctx: BookCtx }) {
  const { data: steps } = useQuery({
    queryKey: ['firstLaunchSteps', ctx.bookId],
    queryFn: () => getFirstLaunchStepsByBookId(ctx.bookId),
    refetchInterval: 1000
  });
  const startedRef = useRef(false);
  const [startError, setStartError] = useState<string | null>(null);

  const overall = steps ? overallStatus(steps) : undefined;

  useEffect(() => {
    if (steps === undefined) return;
    if (startedRef.current) return;
    if (overall === 'done' || overall === 'error') return;

    startedRef.current = true;
    void (async () => {
      try {
        const { characterIds, placeIds } = await getPrimaryCastIdsByBookId(ctx.bookId);
        if (characterIds.length === 0 || placeIds.length === 0) {
          throw new Error(
            'No PRIMARY characters or places found for this book. Finish the import flow first.'
          );
        }
        window.extensionSDK.worker
          .spawn(
            'runFirstLaunch',
            { characterIds, placeIds },
            { singletonKey: 'runFirstLaunch' }
          )
          .catch((err: unknown) => {
            if (isTaskAlreadyRunningError(err)) return;
            window.extensionSDK.log('runFirstLaunch failed', err);
          });
      } catch (err) {
        setStartError(err instanceof Error ? err.message : String(err));
        startedRef.current = false;
      }
    })();
  }, [ctx.bookId, steps, overall]);

  if (steps === undefined || steps === null) {
    return <CenteredLoader />;
  }
  if (overall === 'empty') {
    if (startError) {
      return (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="flex items-start gap-2 border border-destructive/50 bg-destructive/10 p-3 text-left">
            <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
            <p className="font-serif text-xs text-destructive">
              Failed to start: {startError}
            </p>
          </div>
        </div>
      );
    }
    return <CenteredNote>Starting…</CenteredNote>;
  }
  if (overall === 'done') {
    return (
      <Suspense fallback={<CenteredLoader />}>
        <InteractivePicker ctx={ctx} />
      </Suspense>
    );
  }
  return <FirstLaunch ctx={ctx} steps={steps} />;
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
