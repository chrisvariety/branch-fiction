import { invoke } from '@tauri-apps/api/core';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { mintSession, PHONE_SESSION_TTL_SECS } from '@/extensions/session-tokens';

export function PhoneShareDialog({
  open,
  onOpenChange,
  extensionId,
  bookId,
  extensionName,
  entry
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extensionId: string;
  bookId: string;
  extensionName: string;
  entry: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { token } = await mintSession({
          extensionId,
          bookId,
          ttlSecs: PHONE_SESSION_TTL_SECS
        });
        if (cancelled) return;
        const phoneUrl = await invoke<string>('get_path_phone_url', {
          extensionId,
          bookId,
          token,
          entry,
          extensionName
        });
        if (cancelled) return;
        setUrl(phoneUrl);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, extensionId, bookId, extensionName, entry]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open “{extensionName}” on phone</DialogTitle>
          <DialogDescription>
            Scan with your phone’s camera. Phone must be on the same Wi-Fi. Link expires
            in about an hour.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && !url && (
          <div className="flex h-48 items-center justify-center">
            <Spinner />
          </div>
        )}
        {url && (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded bg-white p-3">
              <QRCodeSVG value={url} size={200} />
            </div>
            <code className="block w-full rounded bg-muted px-2 py-1 text-xs break-all select-all">
              {url}
            </code>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
