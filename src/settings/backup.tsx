import { IconDatabaseExport, IconDatabaseImport, IconLoader2 } from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { ask, message, open, save } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

function defaultBackupName(): string {
  return `branch-fiction-${new Date().toISOString().slice(0, 10)}.bfbackup`;
}

export function BackupPage() {
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);

  const handleBackup = async () => {
    const dest = await save({
      defaultPath: defaultBackupName(),
      filters: [{ name: 'Branch Fiction Backup', extensions: ['bfbackup'] }]
    });
    if (!dest) return;
    setBusy('backup');
    try {
      await invoke('create_app_backup', { destPath: dest });
      await message('Backup saved.', { title: 'Backup Complete' });
    } catch (e) {
      await message(String(e), { title: 'Backup Failed', kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: 'Branch Fiction Backup', extensions: ['bfbackup'] }]
    });
    if (!file) return;
    const confirmed = await ask(
      'Restoring replaces your entire library, chats, and extension data with the backup. Anything added since the backup was made will be lost. The app will restart.',
      {
        title: 'Restore Backup',
        kind: 'warning',
        okLabel: 'Restore and Restart',
        cancelLabel: 'Cancel'
      }
    );
    if (!confirmed) return;
    setBusy('restore');
    try {
      // Restarts the app on success, except in dev mode where it resolves false.
      const restarting = await invoke<boolean>('restore_app_backup', { path: file });
      if (!restarting) {
        await message(
          'Restore staged. Quit the app and restart `tauri dev` to apply it.',
          { title: 'Restart Required' }
        );
      }
    } catch (e) {
      await message(String(e), { title: 'Restore Failed', kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="sticky top-0 z-10 bg-background pb-4">
        <h2 className="text-sm font-medium">Backup &amp; Restore</h2>
      </div>

      <div className="space-y-2">
        <div className="flex w-full items-start gap-3 border border-border p-4">
          <IconDatabaseExport className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="space-y-1">
              <p className="text-sm font-medium">Back up</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Save your entire library (books, chats, and extension data) for safe
                storage.
                <br /> Note: Provider API keys are not included.
              </p>
            </div>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => void handleBackup()}
            >
              {busy === 'backup' && <IconLoader2 className="size-3.5 animate-spin" />}
              Back Up…
            </Button>
          </div>
        </div>

        <div className="flex w-full items-start gap-3 border border-border p-4">
          <IconDatabaseImport className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="space-y-1">
              <p className="text-sm font-medium">Restore</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Replaces your entire library with the contents of a backup file and
                restarts the app. Afterwards you will need to re-enter provider API keys
                or re-link your cloud account.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => void handleRestore()}
            >
              {busy === 'restore' && <IconLoader2 className="size-3.5 animate-spin" />}
              Restore…
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
