import { isTaskAlreadyRunningError } from '@branch-fiction/extension-sdk';
import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconCircle,
  IconCircleCheck,
  IconCopy,
  IconDots,
  IconLoader2
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { getPrimaryCastIdsByBookId } from '@/iframe/db/models/book-entity/get-primary-cast-ids';
import {
  type CharacterRefDisplay,
  getCharacterRefDisplayByBookIdAndCharacterIds
} from '@/iframe/db/models/character-ref/get-character-ref-display';
import { resetErroredFirstLaunchSteps } from '@/iframe/db/models/first-launch-step/update-first-launch-step';
import type { FirstLaunchStep, LogLine } from '@/lib/db/types';
import {
  type FirstLaunchStatus,
  mergeStepLogs,
  overallStatus,
  stepStatus
} from '@/lib/first-launch-status';
import { cn } from '@/lib/utils';

type Props = { ctx: ExtensionCtx & { bookId: string }; steps: FirstLaunchStep[] };

const PRIMARY_BUTTON =
  'flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50';

const STATUS_TEXT: Record<FirstLaunchStatus, string> = {
  pending: 'Waiting',
  running: 'Working…',
  done: 'Done',
  error: 'Failed'
};

export function FirstLaunch({ ctx, steps }: Props) {
  const [retrying, setRetrying] = useState(false);
  const overall = overallStatus(steps);

  const refSteps = useMemo(
    () => steps.filter((s) => s.stepId === 'character_reference_image'),
    [steps]
  );
  const characterIds = useMemo(
    () => refSteps.map((s) => s.fanOutKey).filter((id): id is string => id !== null),
    [refSteps]
  );
  const characterIdsKey = characterIds.join(',');
  const { data: refDisplay } = useQuery({
    queryKey: ['characterRefDisplay', ctx.bookId, characterIdsKey],
    queryFn: () =>
      getCharacterRefDisplayByBookIdAndCharacterIds(ctx.bookId, characterIds),
    refetchInterval: 1000
  });
  const displayById = useMemo(() => {
    const map = new Map<string, CharacterRefDisplay>();
    for (const d of refDisplay ?? []) map.set(d.id, d);
    return map;
  }, [refDisplay]);

  const retry = async () => {
    setRetrying(true);
    try {
      await resetErroredFirstLaunchSteps(ctx.bookId);
      const { characterIds: cIds, placeIds } = await getPrimaryCastIdsByBookId(
        ctx.bookId
      );
      window.extensionSDK.worker
        .spawn(
          'runFirstLaunch',
          { characterIds: cIds, placeIds },
          { singletonKey: 'runFirstLaunch' }
        )
        .catch((err: unknown) => {
          if (isTaskAlreadyRunningError(err)) return;
          window.extensionSDK.log('runFirstLaunch retry failed', err);
        });
    } finally {
      setRetrying(false);
    }
  };

  const charGen = steps.find((s) => s.stepId === 'character_interactive_generate');
  const charFin = steps.find((s) => s.stepId === 'character_interactive_finalize');
  const placeGen = steps.find((s) => s.stepId === 'place_interactive_generate');
  const placeFin = steps.find((s) => s.stepId === 'place_interactive_finalize');

  const firstError = steps.find((s) => s.lastError !== null);

  const characterInteractiveSteps = useMemo(
    () => [charGen, charFin].filter((s): s is FirstLaunchStep => !!s),
    [charGen, charFin]
  );
  const placeInteractiveSteps = useMemo(
    () => [placeGen, placeFin].filter((s): s is FirstLaunchStep => !!s),
    [placeGen, placeFin]
  );

  return (
    <div className="flex flex-1 flex-col gap-6 px-10 pt-12 pb-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <p className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          Preparing
        </p>
        <h1 className="font-serif text-xl tracking-tight text-balance">
          Setting up your interactives
        </h1>
        <div className="h-px w-12 bg-border" />
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          This runs once per book. Keep this window open.
        </p>
      </header>

      <section className="border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-sm tracking-tight">
            Character Reference Images
          </h2>
          <SectionLogsMenu title="Character Reference Images" steps={refSteps} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {refSteps.map((step) => (
            <CharacterRefBox
              key={step.id}
              step={step}
              display={step.fanOutKey ? displayById.get(step.fanOutKey) : undefined}
            />
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <InteractivePanel
          title="Character Interactive"
          generate={charGen}
          finalize={charFin}
          logsSteps={characterInteractiveSteps}
        />
        <InteractivePanel
          title="Place Interactive"
          generate={placeGen}
          finalize={placeFin}
          logsSteps={placeInteractiveSteps}
        />
      </section>

      {overall === 'error' && firstError && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex w-full items-start gap-2 border border-destructive/50 bg-destructive/10 p-3 text-left">
            <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
            <p className="font-serif text-xs text-destructive">
              {firstError.lastError ?? 'Unknown error'}
            </p>
          </div>
          <button className={PRIMARY_BUTTON} onClick={retry} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}
    </div>
  );
}

function SectionLogsMenu({ title, steps }: { title: string; steps: FirstLaunchStep[] }) {
  const [open, setOpen] = useState(false);
  const logs = useMemo(() => mergeStepLogs(steps), [steps]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex size-6 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground">
          <IconDots className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => setOpen(true)}
            disabled={logs.length === 0}
            data-disabled={logs.length === 0 ? '' : undefined}
          >
            View Logs
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex h-[70vh] flex-col gap-3 p-0 sm:max-w-3xl"
          initialFocus={false}
        >
          <div className="flex items-center gap-2 px-4 pt-4 pr-12">
            <DialogTitle className="flex-1">{title} logs</DialogTitle>
            <CopyLogsButton logs={logs} />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <LogPane logs={logs} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const logLevelColor: Record<string, string> = {
  error: 'text-destructive',
  warn: 'text-yellow-500',
  info: 'text-muted-foreground',
  debug: 'text-muted-foreground/60'
};

function formatLogsForClipboard(logs: LogLine[]): string {
  return logs
    .map((line) => {
      const level = line.level.toUpperCase().padEnd(5);
      const head = `${line.timestamp} ${level} ${line.message}`;
      const meta =
        line.metadata && Object.keys(line.metadata).length > 0
          ? '\n' +
            JSON.stringify(line.metadata, null, 2)
              .split('\n')
              .map((l) => `  ${l}`)
              .join('\n')
          : '';
      return head + meta;
    })
    .join('\n');
}

function CopyLogsButton({ logs }: { logs: LogLine[] }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(formatLogsForClipboard(logs));
      setCopied(true);
    } catch (err) {
      window.extensionSDK.log('copy logs failed', err);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={logs.length === 0}
      className="flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground disabled:opacity-40"
    >
      {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function LogPane({ logs }: { logs: LogLine[] }) {
  const reversed = useMemo(() => [...logs].reverse(), [logs]);

  if (reversed.length === 0) {
    return (
      <div className="flex size-full items-center justify-center bg-muted/20">
        <span className="text-muted-foreground/40">Waiting for logs…</span>
      </div>
    );
  }

  return (
    <div className="size-full overflow-y-auto bg-muted/20 px-4 py-3 font-mono text-[11px] leading-relaxed">
      {reversed.map((entry, i) => (
        <LogRow key={i} entry={entry} />
      ))}
    </div>
  );
}

function LogRow({ entry }: { entry: LogLine }) {
  const hasMetadata = !!entry.metadata && Object.keys(entry.metadata).length > 0;
  const row = (
    <div className="flex gap-2 text-left">
      <span className="shrink-0 text-muted-foreground/40">
        {new Date(entry.timestamp).toLocaleTimeString()}
      </span>
      <span
        className={cn(
          'shrink-0 uppercase',
          logLevelColor[entry.level] || 'text-muted-foreground'
        )}
      >
        {entry.level.slice(0, 4).padEnd(4)}
      </span>
      <span className="whitespace-pre-wrap text-foreground">
        {entry.message.replace(/^\n+/, '')}
      </span>
    </div>
  );

  if (!hasMetadata) return row;

  return (
    <Collapsible>
      <CollapsibleTrigger className="w-full cursor-pointer hover:bg-muted/40">
        {row}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 mb-2 ml-30 overflow-x-auto break-all whitespace-pre-wrap text-muted-foreground/80">
          {JSON.stringify(entry.metadata, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StepStatusGlyph({ status }: { status: FirstLaunchStatus }) {
  if (status === 'done') {
    return <IconCircleCheck className="size-3.5 shrink-0 text-primary/70" />;
  }
  if (status === 'error') {
    return <IconAlertCircle className="size-3.5 shrink-0 text-destructive" />;
  }
  if (status === 'running') {
    return <IconLoader2 className="size-3.5 shrink-0 animate-spin text-primary" />;
  }
  return <IconCircle className="size-3.5 shrink-0 text-muted-foreground/30" />;
}

function statusBorderClass(status: FirstLaunchStatus) {
  if (status === 'error') return 'border-destructive/50';
  if (status === 'done') return 'border-border';
  return 'border-dashed border-border';
}

function CharacterRefBox({
  step,
  display
}: {
  step: FirstLaunchStep;
  display: CharacterRefDisplay | undefined;
}) {
  const status = stepStatus(step);
  const imageUrl = display?.imageUrl ?? null;
  const name = display?.name ?? '…';

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 border bg-background p-2',
        statusBorderClass(status)
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        {imageUrl && status === 'done' ? (
          <img
            src={transformImageUrl(imageUrl)}
            alt={name}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
            {status === 'running' ? 'Generating…' : STATUS_TEXT[status]}
          </div>
        )}
      </div>
      <div className="truncate font-serif text-xs text-foreground">{name}</div>
    </div>
  );
}

function InteractivePanel({
  title,
  generate,
  finalize,
  logsSteps
}: {
  title: string;
  generate: FirstLaunchStep | undefined;
  finalize: FirstLaunchStep | undefined;
  logsSteps: FirstLaunchStep[];
}) {
  const genStatus = generate ? stepStatus(generate) : 'pending';
  const finStatus = finalize ? stepStatus(finalize) : 'pending';
  const inactive = genStatus === 'pending' && finStatus === 'pending';

  return (
    <div className={cn('border border-border bg-card p-4', inactive && 'opacity-50')}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-sm tracking-tight">{title}</h2>
        <SectionLogsMenu title={title} steps={logsSteps} />
      </div>
      <div className="flex flex-col gap-2">
        <StepBox label="Generating" status={genStatus} />
        <StepBox label="Finalizing" status={finStatus} />
      </div>
    </div>
  );
}

function StepBox({ label, status }: { label: string; status: FirstLaunchStatus }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border bg-background px-3 py-2',
        statusBorderClass(status)
      )}
    >
      <span className="font-serif text-xs text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          {STATUS_TEXT[status]}
        </span>
        <StepStatusGlyph status={status} />
      </div>
    </div>
  );
}
