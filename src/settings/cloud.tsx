import { useQuery } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';

import { CloudAccess, CloudBenefits } from '@/components/cloud/access';
import { DEFAULT_USER_ID } from '@/lib/auth';
import { CLOUD_API } from '@/lib/cloud';
import { linkCloudAccount } from '@/lib/cloud-link';
import { getUserById } from '@/lib/db/models/user/get-user';

async function fetchDefaultUser() {
  return (await getUserById(DEFAULT_USER_ID)) ?? null;
}

async function fetchMembershipEmail(externalId: string): Promise<string | null> {
  const res = await fetch(`${CLOUD_API}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: externalId })
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    success: boolean;
    result?: { email: string | null };
  };
  return data.result?.email ?? null;
}

export function CloudPage() {
  const userQuery = useQuery({
    queryKey: ['user', DEFAULT_USER_ID],
    queryFn: fetchDefaultUser
  });

  const externalId = userQuery.data?.externalId ?? undefined;

  const emailQuery = useQuery({
    queryKey: ['membership-email', externalId],
    queryFn: () => fetchMembershipEmail(externalId!),
    enabled: !!externalId
  });

  if (!externalId) {
    return (
      <CloudAccess
        onOpenExternal={(url) => void openUrl(url)}
        invalidationQueryKeys={[['user', DEFAULT_USER_ID], ['providers']]}
        linkCloudAccount={linkCloudAccount}
      />
    );
  }

  return <CloudMembership externalId={externalId} email={emailQuery.data ?? null} />;
}

function CloudMembership({
  externalId,
  email
}: {
  externalId: string;
  email: string | null;
}) {
  const openPortal = async () => {
    const res = await fetch(`${CLOUD_API}/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: externalId })
    });
    if (!res.ok) return;
    const data = (await res.json()) as { success: boolean; result?: { url: string } };
    if (data.result?.url) void openUrl(data.result.url);
  };

  return (
    <div className="flex flex-1 flex-col items-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 className="font-serif text-xl tracking-tight text-balance">
            Cloud membership
          </h2>
          <div className="h-px w-8 bg-border" />
          <p className="text-xs text-muted-foreground">
            You're getting these benefits
            {email && (
              <>
                {' '}
                as <span className="font-medium text-foreground">{email}</span>
              </>
            )}
            .
          </p>
        </div>

        <CloudBenefits />

        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground underline underline-offset-2"
          onClick={openPortal}
        >
          Manage membership
        </button>
      </div>
    </div>
  );
}
