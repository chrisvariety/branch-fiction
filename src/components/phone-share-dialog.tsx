import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { mintSession, PHONE_SESSION_TTL_SECS } from '@/extensions/session-tokens';
import { DEFAULT_USER_ID } from '@/lib/auth';
import { getUserById } from '@/lib/db/models/user/get-user';

type ShareProps = {
  extensionId: string;
  bookId: string;
  extensionName: string;
  entry: string;
};

export function PhoneShareDialog({
  open,
  onOpenChange,
  extensionId,
  bookId,
  extensionName,
  entry
}: ShareProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const userQuery = useQuery({
    queryKey: ['user', DEFAULT_USER_ID],
    queryFn: () => getUserById(DEFAULT_USER_ID)
  });
  const externalId = userQuery.data?.externalId ?? null;

  const [tab, setTab] = useState('local');
  const shared: ShareProps = { extensionId, bookId, extensionName, entry };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open “{extensionName}” on phone</DialogTitle>
          {!externalId && (
            <DialogDescription>
              Scan with your phone’s camera. Phone must be on the same Wi-Fi. Link expires
              in about an hour.
            </DialogDescription>
          )}
        </DialogHeader>

        {externalId ? (
          <Tabs value={tab} onValueChange={(value) => setTab(value as string)}>
            <TabsList className="mx-auto">
              <TabsTrigger value="local">Local network</TabsTrigger>
              <TabsTrigger value="cloud">Cloud Share</TabsTrigger>
            </TabsList>
            <TabsContent value="local">
              <LocalShare {...shared} active={open && tab === 'local'} />
            </TabsContent>
            <TabsContent value="cloud">
              <CloudShare
                {...shared}
                externalId={externalId}
                active={open && tab === 'cloud'}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <LocalShare {...shared} active={open} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LocalShare({
  extensionId,
  bookId,
  extensionName,
  entry,
  active
}: ShareProps & {
  active: boolean;
}) {
  const { data, error } = useQuery({
    queryKey: ['phone-share', 'local', extensionId, bookId],
    enabled: active,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { token } = await mintSession({
        extensionId,
        bookId,
        ttlSecs: PHONE_SESSION_TTL_SECS
      });
      return invoke<string>('get_path_phone_url', {
        extensionId,
        bookId,
        token,
        entry,
        extensionName
      });
    }
  });
  return (
    <QrBlock
      url={data ?? null}
      error={error ? error.message : null}
      caption="Works when your phone is on the same Wi-Fi."
    />
  );
}

function CloudShare({
  extensionId,
  bookId,
  extensionName,
  entry,
  externalId,
  active
}: ShareProps & {
  externalId: string;
  active: boolean;
}) {
  const { data, error } = useQuery({
    queryKey: ['phone-share', 'cloud', extensionId, bookId],
    enabled: active,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { token } = await mintSession({
        extensionId,
        bookId,
        ttlSecs: PHONE_SESSION_TTL_SECS
      });
      return invoke<string>('get_cloud_phone_url', {
        externalId,
        extensionId,
        bookId,
        token,
        entry,
        extensionName
      });
    }
  });
  return (
    <QrBlock
      url={data ?? null}
      error={error ? error.message : null}
      caption="Works on any network, even cellular."
    />
  );
}

function QrBlock({
  url,
  error,
  caption
}: {
  url: string | null;
  error: string | null;
  caption: string;
}) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-3">
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : !url ? (
        <Spinner />
      ) : (
        <>
          <div className="rounded bg-white p-3">
            <QRCodeSVG value={url} size={200} />
          </div>
          <code className="block w-full rounded bg-muted px-2 py-1 text-xs break-all select-all">
            {url}
          </code>
          <p className="text-xs text-muted-foreground">{caption}</p>
        </>
      )}
    </div>
  );
}
