import { IconCloud, IconDeviceMobile, IconHeart, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { RestorePurchase } from '@/components/cloud/restore-purchase';
import { Button } from '@/components/ui/button';
import { CLOUD_API } from '@/lib/cloud';

export function CloudAccess({
  onBack,
  onOpenExternal,
  invalidationQueryKeys,
  linkCloudAccount
}: {
  onBack?: () => void;
  onOpenExternal: (url: string) => void;
  invalidationQueryKeys: string[][];
  linkCloudAccount: (externalId: string) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${CLOUD_API}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error('Failed to create checkout');
      const data = (await res.json()) as {
        success: boolean;
        result: { checkoutId: string; url: string };
      };
      return data.result;
    },
    onSuccess: (result) => {
      setCheckoutId(result.checkoutId);
      onOpenExternal(result.url);
    }
  });

  const provisionMutation = useMutation({
    mutationFn: async (cloudUserId: string) => {
      await linkCloudAccount(cloudUserId);
    },
    onSuccess: () => {
      for (const key of invalidationQueryKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    }
  });

  const statusQuery = useQuery({
    queryKey: ['checkout-status', checkoutId],
    queryFn: async () => {
      const res = await fetch(`${CLOUD_API}/checkout/${checkoutId}`);
      if (!res.ok) throw new Error('Failed to fetch checkout status');
      const data = (await res.json()) as {
        success: boolean;
        result: { status: string; paid: boolean; userId: string | null };
      };

      if (
        data.result.paid &&
        data.result.userId &&
        (provisionMutation.isIdle || provisionMutation.isError)
      ) {
        provisionMutation.mutate(data.result.userId);
      }

      return data.result;
    },
    enabled: !!checkoutId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'open' ? 3000 : false;
    }
  });

  if (showRestore) {
    return (
      <RestorePurchase
        onBack={() => setShowRestore(false)}
        invalidationQueryKeys={invalidationQueryKeys}
        linkCloudAccount={linkCloudAccount}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 className="font-serif text-xl tracking-tight text-balance">Cloud Access</h2>
          <div className="h-px w-8 bg-border" />
          {!checkoutId && (
            <p className="text-xs text-muted-foreground">
              A one-time, pay-what-you-can unlock for the cloud features. No subscription.
            </p>
          )}
        </div>

        {checkoutId ? (
          <div className="space-y-2 text-center">
            <p className="text-sm text-muted-foreground">
              Waiting for checkout to complete...
            </p>
            <p className="text-xs text-muted-foreground">
              Complete your purchase in the browser window that just opened.
            </p>
            {provisionMutation.isError && (
              <p className="text-xs text-destructive">
                {provisionMutation.error.message}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => statusQuery.refetch()}
            >
              <IconRefresh
                className={`size-3.5 ${statusQuery.isFetching ? 'animate-spin' : ''}`}
              />
              Refresh now
            </Button>
          </div>
        ) : (
          <>
            <CloudBenefits>
              <li className="flex items-start gap-3">
                <IconHeart className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Pay what you can</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    One payment, no subscription!
                  </p>
                </div>
              </li>
            </CloudBenefits>

            <Button
              className="w-full"
              disabled={checkoutMutation.isPending}
              onClick={() => checkoutMutation.mutate()}
            >
              {checkoutMutation.isPending
                ? 'Creating checkout...'
                : 'Continue to checkout'}
            </Button>

            {checkoutMutation.isError && (
              <p className="text-xs text-destructive">{checkoutMutation.error.message}</p>
            )}

            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => setShowRestore(true)}
            >
              Restore previous purchase
            </button>
          </>
        )}

        {onBack && (
          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground underline underline-offset-2"
            onClick={onBack}
          >
            Back
          </button>
        )}
      </div>
    </div>
  );
}

export function CloudBenefits({ children }: { children?: ReactNode }) {
  return (
    <ul className="space-y-3">
      <li className="flex items-start gap-3">
        <IconCloud className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Cloud backups</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Keep encrypted backups of your whole library online and restore them on any
            device. The recovery key stays on your device, so only you can read them.
          </p>
        </div>
      </li>
      <li className="flex items-start gap-3">
        <IconDeviceMobile className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Phone sharing anywhere</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Open your books on your phone over any network, even cellular (not just when
            you're both on the same Wi-Fi).
          </p>
        </div>
      </li>
      {children}
    </ul>
  );
}
