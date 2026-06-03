import { IconAlertTriangle, IconClock, IconCoin } from '@tabler/icons-react';

import { NotifyButton } from '@/new-book/notify-button';

export function formatSeconds(sec: number): string {
  const totalMinutes = Math.max(1, Math.round(sec / 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function formatDurationRange(
  min: number,
  max: number | null,
  behavior?: 'normal' | 'unknown' | null
): string {
  const base =
    max === null || max === min
      ? `~${formatSeconds(min)}`
      : `${formatSeconds(min)}–${formatSeconds(max)}`;
  return behavior === 'unknown' ? `${base} or more` : base;
}

export function formatCents(cents: number): string {
  if (cents < 1) return '<$0.01';
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatCostRange(
  min: number,
  max: number | null,
  behavior?: 'normal' | 'unknown' | null
): string {
  const base =
    max === null || max === min
      ? `~${formatCents(min)}`
      : `${formatCents(min)}–${formatCents(max)}`;
  return behavior === 'unknown' ? `${base} or more` : base;
}

const UNCERTAIN_TOOLTIP =
  'This model is running outside the band our projection is based on. The estimate may be much higher than shown.';

export function ImportEstimateRow({
  etaMinSeconds,
  etaMaxSeconds,
  costMinCents,
  costMaxCents,
  behavior,
  etaTitle,
  costTitle
}: {
  etaMinSeconds: number | null;
  etaMaxSeconds: number | null;
  costMinCents: number | null;
  costMaxCents: number | null;
  behavior?: 'normal' | 'unknown' | null;
  etaTitle?: string;
  costTitle?: string;
}) {
  const hasEta = etaMinSeconds != null;
  const hasCost = costMinCents != null;
  const uncertainTitle = behavior === 'unknown' ? UNCERTAIN_TOOLTIP : undefined;
  return (
    <div className="flex items-center gap-3 font-serif text-xs text-muted-foreground tabular-nums">
      <span className="flex items-center gap-1" title={etaTitle ?? uncertainTitle}>
        <IconClock className="-mt-px size-3" />
        {hasEta ? formatDurationRange(etaMinSeconds, etaMaxSeconds, behavior) : '—'}
      </span>
      <span className="h-3 w-px bg-border" />
      <span className="flex items-center gap-1" title={costTitle ?? uncertainTitle}>
        <IconCoin className="-mt-px size-3" />
        {hasCost ? formatCostRange(costMinCents, costMaxCents, behavior) : '—'}
      </span>
    </div>
  );
}

export function ProjectionConfirmActions({
  resuming,
  etaMinSeconds,
  etaMaxSeconds,
  costMinCents,
  costMaxCents,
  behavior,
  showEstimate,
  notifyEnabled,
  cacheWarning,
  onBegin,
  onCancel,
  onNotify
}: {
  resuming?: boolean;
  etaMinSeconds?: number | null;
  etaMaxSeconds?: number | null;
  costMinCents?: number | null;
  costMaxCents?: number | null;
  behavior?: 'normal' | 'unknown' | null;
  showEstimate?: boolean;
  notifyEnabled?: boolean;
  cacheWarning?: boolean;
  onBegin: () => void;
  onCancel: () => void;
  onNotify?: (enabled: boolean) => void;
}) {
  const costUnavailable = costMinCents == null;
  return (
    <div className="flex flex-col items-center gap-3">
      {showEstimate && (
        <ImportEstimateRow
          etaMinSeconds={etaMinSeconds ?? null}
          etaMaxSeconds={etaMaxSeconds ?? null}
          costMinCents={costMinCents ?? null}
          costMaxCents={costMaxCents ?? null}
          behavior={behavior}
        />
      )}
      {cacheWarning && (
        <div className="flex max-w-xs items-start gap-2 border border-yellow-500/50 bg-yellow-500/10 p-2 text-left">
          <IconAlertTriangle className="size-4 shrink-0 text-yellow-500" />
          <p className="text-xs text-yellow-700 dark:text-yellow-400">
            Prompt caching doesn't appear to be working with this provider. Without
            caching, the actual cost may be substantially higher than estimated.
          </p>
        </div>
      )}
      <p className="max-w-xs text-center font-serif text-xs leading-relaxed text-muted-foreground">
        {costUnavailable
          ? "We weren't able to estimate cost for this provider. Review the time estimate above. After you click 'Begin import', feel free to plug in your computer and walk away."
          : "Review the time and cost estimates above. After you click 'Begin import', feel free to plug in your computer and walk away."}
      </p>
      {onNotify && <NotifyButton enabled={!!notifyEnabled} onChange={onNotify} />}
      <button
        type="button"
        disabled={resuming}
        className="flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        onClick={onBegin}
      >
        {resuming ? 'Starting' : 'Begin Import'}
      </button>
      <button
        type="button"
        className="mt-4 font-serif text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
