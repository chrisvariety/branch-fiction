import { IconCloud, IconExternalLink } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';

import { CloudAccess } from '@/components/cloud/access';
import { DEFAULT_USER_ID } from '@/lib/auth';
import { CLOUD_API } from '@/lib/cloud';
import { linkCloudAccount } from '@/lib/cloud-link';
import { getUserById } from '@/lib/db/models/user/get-user';

import { ColumnHeader } from './column-header';

type UsageRow = {
  provider: string;
  model: string | null;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
};

type CloudStatus = {
  email: string | null;
  name: string | null;
  subscription_status: string | null;
  subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  spend_cap_micros: number;
  period_spend_micros: number;
  usage: UsageRow[];
};

function formatDollars(micros: number): string {
  return (micros / 1_000_000).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD'
  });
}

async function fetchDefaultUser() {
  return (await getUserById(DEFAULT_USER_ID)) ?? null;
}

async function fetchCloudStatus(externalId: string): Promise<CloudStatus | null> {
  const res = await fetch(`${CLOUD_API}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: externalId })
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { success: boolean; result?: CloudStatus };
  return data.result ?? null;
}

export function CloudPage() {
  const userQuery = useQuery({
    queryKey: ['user', DEFAULT_USER_ID],
    queryFn: fetchDefaultUser
  });

  const externalId = userQuery.data?.externalId;

  const cloudQuery = useQuery({
    queryKey: ['cloud-status', externalId],
    queryFn: () => fetchCloudStatus(externalId!),
    enabled: !!externalId
  });

  const status = cloudQuery.data;

  return (
    <div className="space-y-6">
      {(externalId || cloudQuery.isLoading || cloudQuery.isError) && (
        <ColumnHeader icon={IconCloud}>Cloud</ColumnHeader>
      )}

      {!externalId ? (
        <NotLinked />
      ) : cloudQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading cloud status...</p>
      ) : !status ? (
        <p className="text-xs text-muted-foreground">Unable to fetch cloud status.</p>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs">
            {status.email && (
              <>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{status.email}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Subscription</dt>
            <dd>{status.subscription_status ?? 'None'}</dd>
            {status.current_period_end && (
              <>
                <dt className="text-muted-foreground">Period</dt>
                <dd>
                  {status.current_period_start && (
                    <>{new Date(status.current_period_start).toLocaleDateString()} – </>
                  )}
                  {new Date(status.current_period_end).toLocaleDateString()}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Spending cap</dt>
            <dd className="tabular-nums">
              {formatDollars(status.period_spend_micros)} /{' '}
              {formatDollars(status.spend_cap_micros)}
            </dd>
          </dl>

          <p className="text-xs text-muted-foreground">
            When you reach your cap, cloud requests pause and we email you a link to raise
            it.
          </p>

          <UsageTable rows={status.usage} />

          {externalId && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-2"
              onClick={async () => {
                const res = await fetch(`${CLOUD_API}/portal`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: externalId })
                });
                if (!res.ok) return;
                const data = (await res.json()) as {
                  success: boolean;
                  result?: { url: string };
                };
                if (data.result?.url) {
                  void openUrl(data.result.url);
                }
              }}
            >
              <IconExternalLink className="size-3.5" />
              Manage subscription
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function UsageTable({ rows }: { rows: UsageRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No usage for the current period.</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">Usage this period</div>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-normal">Model</th>
            <th className="text-right font-normal">Calls</th>
            <th className="text-right font-normal">Input</th>
            <th className="text-right font-normal">Output</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.provider}/${r.model ?? 'unknown'}`}>
              <td className="text-left">{r.model ?? 'unknown'}</td>
              <td className="text-right">{r.requests.toLocaleString()}</td>
              <td className="text-right">{formatTokens(r.input_tokens)}</td>
              <td className="text-right">{formatTokens(r.output_tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotLinked() {
  return (
    <CloudAccess
      onOpenExternal={(url) => void openUrl(url)}
      invalidationQueryKeys={[['user', DEFAULT_USER_ID], ['providers']]}
      linkCloudAccount={linkCloudAccount}
    />
  );
}
