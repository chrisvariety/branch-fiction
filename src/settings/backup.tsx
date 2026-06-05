import {
  IconCheck,
  IconCloud,
  IconCloudDownload,
  IconCloudUpload,
  IconCopy,
  IconDatabaseExport,
  IconDatabaseImport,
  IconLoader2,
  IconTrash
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Channel, invoke } from '@tauri-apps/api/core';
import { ask, message, open, save } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { DEFAULT_USER_ID } from '@/lib/auth';
import { getUserById } from '@/lib/db/models/user/get-user';

type Busy = 'backup' | 'restore' | 'cloud-backup' | 'cloud-restore' | null;

type RecoveryKey = { phrase: string; fingerprint: string };

type CloudBackupEntry = {
  id: string;
  sizeBytes: number | null;
  schemaVersion: number;
  keyFingerprint: string;
  createdAt: string;
};

type BackupProgress = { stage: string; transferred: number; total: number };

function defaultBackupName(): string {
  return `branch-fiction-${new Date().toISOString().slice(0, 10)}.bfbackup`;
}

function formatBytes(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function progressLabel(p: BackupProgress | null): string {
  if (!p) return 'Working…';
  switch (p.stage) {
    case 'packing':
      return 'Preparing backup…';
    case 'encrypting':
      return 'Encrypting…';
    case 'decrypting':
      return 'Decrypting…';
    case 'uploading':
    case 'downloading': {
      const verb = p.stage === 'uploading' ? 'Uploading' : 'Downloading';
      const done = formatBytes(p.transferred);
      return p.total > 0
        ? `${verb} ${done} / ${formatBytes(p.total)}`
        : `${verb} ${done}`;
    }
    default:
      return 'Working…';
  }
}

const RESTORE_WARNING =
  'Restoring replaces your entire library, chats, and extension data with the backup. Anything added since the backup was made will be lost. The app will restart.';

export function BackupPage() {
  const [busy, setBusy] = useState<Busy>(null);

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
    const confirmed = await ask(RESTORE_WARNING, {
      title: 'Restore Backup',
      kind: 'warning',
      okLabel: 'Restore and Restart',
      cancelLabel: 'Cancel'
    });
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
        <CloudBackupSection busy={busy} setBusy={setBusy} />

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

function CloudBackupSection({
  busy,
  setBusy
}: {
  busy: Busy;
  setBusy: (b: Busy) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [revealedPhrase, setRevealedPhrase] = useState<string | null>(null);
  const [enteringKey, setEnteringKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');

  const userQuery = useQuery({
    queryKey: ['user', DEFAULT_USER_ID],
    queryFn: async () => (await getUserById(DEFAULT_USER_ID)) ?? null
  });
  const externalId = userQuery.data?.externalId;

  const keyQuery = useQuery({
    queryKey: ['backup-recovery-key'],
    queryFn: () => invoke<RecoveryKey | null>('get_backup_recovery_key'),
    enabled: !!externalId
  });
  const recoveryKey = keyQuery.data ?? null;

  const backupsQuery = useQuery({
    queryKey: ['cloud-backups'],
    queryFn: () => invoke<CloudBackupEntry[]>('list_cloud_backups'),
    enabled: !!externalId
  });

  const refreshKey = () =>
    queryClient.invalidateQueries({ queryKey: ['backup-recovery-key'] });
  const refreshBackups = () =>
    queryClient.invalidateQueries({ queryKey: ['cloud-backups'] });

  const handleGenerateKey = async () => {
    try {
      const key = await invoke<RecoveryKey>('create_backup_recovery_key');
      setRevealedPhrase(key.phrase);
      await refreshKey();
    } catch (e) {
      await message(String(e), { title: 'Recovery Key', kind: 'error' });
    }
  };

  const handleSaveKey = async () => {
    try {
      await invoke<RecoveryKey>('set_backup_recovery_key', { phrase: keyInput });
      setEnteringKey(false);
      setKeyInput('');
      await refreshKey();
    } catch (e) {
      await message(String(e), { title: 'Recovery Key', kind: 'error' });
    }
  };

  const handleCloudBackup = async () => {
    setBusy('cloud-backup');
    const onProgress = new Channel<BackupProgress>();
    onProgress.onmessage = setProgress;
    try {
      await invoke('create_cloud_backup', { onProgress });
      await refreshBackups();
      await message('Backup completed.', { title: 'Cloud Backup Complete' });
    } catch (e) {
      await message(String(e), { title: 'Cloud Backup Failed', kind: 'error' });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const handleCloudRestore = async (backup: CloudBackupEntry) => {
    if (recoveryKey && backup.keyFingerprint !== recoveryKey.fingerprint) {
      await message(
        'This backup was encrypted with a different recovery key. Enter that key first to restore it.',
        { title: 'Different Recovery Key', kind: 'warning' }
      );
      return;
    }
    const confirmed = await ask(RESTORE_WARNING, {
      title: 'Restore Cloud Backup',
      kind: 'warning',
      okLabel: 'Restore and Restart',
      cancelLabel: 'Cancel'
    });
    if (!confirmed) return;
    setBusy('cloud-restore');
    const onProgress = new Channel<BackupProgress>();
    onProgress.onmessage = setProgress;
    try {
      // Restarts the app on success, except in dev mode where it resolves false.
      const restarting = await invoke<boolean>('restore_cloud_backup', {
        id: backup.id,
        onProgress
      });
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
      setProgress(null);
    }
  };

  const handleCloudDelete = async (backup: CloudBackupEntry) => {
    const confirmed = await ask('Delete this cloud backup permanently?', {
      title: 'Delete Backup',
      kind: 'warning',
      okLabel: 'Delete',
      cancelLabel: 'Cancel'
    });
    if (!confirmed) return;
    try {
      await invoke('delete_cloud_backup', { id: backup.id });
      await refreshBackups();
    } catch (e) {
      await message(String(e), { title: 'Delete Failed', kind: 'error' });
    }
  };

  if (userQuery.isLoading) return null;

  // Not on cloud yet: contrasting call-out instead of the standard card.
  if (!externalId) {
    return (
      <div className="flex w-full items-start gap-3 border border-primary/40 bg-primary/5 p-4">
        <IconCloud className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex-1 space-y-2">
          <div className="space-y-1">
            <p className="text-sm font-medium">Cloud backup</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Keep backups of your library online and restore them on any device. Cloud
              backups are encrypted with a recovery key that never leaves your device. No
              one else can read them.
            </p>
          </div>
          <Button size="sm" onClick={() => void router.navigate({ to: '/cloud' })}>
            Set Up Cloud
          </Button>
        </div>
      </div>
    );
  }

  const cloudBusy = busy === 'cloud-backup' || busy === 'cloud-restore';

  return (
    <div className="flex w-full items-start gap-3 border border-border p-4">
      <IconCloudUpload className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="space-y-1">
          <p className="text-sm font-medium">Cloud backup</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Keep backups of your library online and restore them on any device. Cloud
            backups are encrypted with a recovery key that never leaves your device. No
            one else can read them.
          </p>
        </div>

        {revealedPhrase ? (
          <RecoveryPhrasePanel
            phrase={revealedPhrase}
            onDone={() => setRevealedPhrase(null)}
          />
        ) : !recoveryKey ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => void handleGenerateKey()}
              >
                Generate Recovery Key
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => setEnteringKey((v) => !v)}
              >
                I Have a Recovery Key
              </Button>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Cloud backups need a recovery key. Write it down somewhere safe as it cannot
              be recovered if lost.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => void handleCloudBackup()}
              >
                {busy === 'cloud-backup' && (
                  <IconLoader2 className="size-3.5 animate-spin" />
                )}
                Back Up to Cloud…
              </Button>
              {cloudBusy && (
                <span className="text-xs text-muted-foreground">
                  {progressLabel(progress)}
                </span>
              )}
            </div>

            <CloudBackupList
              backups={backupsQuery.data ?? []}
              loading={backupsQuery.isLoading}
              error={backupsQuery.isError}
              currentFingerprint={recoveryKey.fingerprint}
              disabled={busy !== null}
              restoring={busy === 'cloud-restore'}
              onRestore={(b) => void handleCloudRestore(b)}
              onDelete={(b) => void handleCloudDelete(b)}
            />

            <p className="text-xs text-muted-foreground">
              Recovery key {recoveryKey.fingerprint}
              {' · '}
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => setRevealedPhrase(recoveryKey.phrase)}
              >
                View
              </button>
              {' · '}
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => setEnteringKey((v) => !v)}
              >
                Replace
              </button>
            </p>
          </div>
        )}

        {enteringKey && !revealedPhrase && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Enter your 12-word recovery key"
              spellCheck={false}
              autoCapitalize="off"
              className="w-full max-w-md border border-border bg-background px-2 py-1.5 text-xs"
            />
            <Button
              size="sm"
              disabled={!keyInput.trim()}
              onClick={() => void handleSaveKey()}
            >
              Save
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RecoveryPhrasePanel({ phrase, onDone }: { phrase: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const words = phrase.split(' ');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(phrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex max-w-md flex-col gap-3 border border-border bg-muted/40 p-4">
      <p className="text-xs leading-relaxed font-medium">
        Your recovery key. Write it down and keep it safe — it cannot be recovered if
        lost, and your backups cannot be read without it.
      </p>
      <ol className="grid grid-cols-3 gap-x-4 gap-y-1.5">
        {words.map((word, i) => (
          <li key={i} className="flex items-baseline gap-1.5 text-xs">
            <span className="w-4 text-right text-muted-foreground">{i + 1}</span>
            <span className="font-mono font-medium">{word}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
          {copied ? (
            <IconCheck className="size-3.5" />
          ) : (
            <IconCopy className="size-3.5" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" onClick={onDone}>
          I&apos;ve Saved My Recovery Key
        </Button>
      </div>
    </div>
  );
}

function CloudBackupList({
  backups,
  loading,
  error,
  currentFingerprint,
  disabled,
  restoring,
  onRestore,
  onDelete
}: {
  backups: CloudBackupEntry[];
  loading: boolean;
  error: boolean;
  currentFingerprint: string;
  disabled: boolean;
  restoring: boolean;
  onRestore: (b: CloudBackupEntry) => void;
  onDelete: (b: CloudBackupEntry) => void;
}) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading backups…</p>;
  }
  if (error) {
    return <p className="text-xs text-muted-foreground">Unable to fetch backups.</p>;
  }
  if (backups.length === 0) {
    return <p className="text-xs text-muted-foreground">No cloud backups yet.</p>;
  }
  return (
    <ul className="flex max-w-md flex-col divide-y divide-border border border-border">
      {backups.map((backup) => (
        <li key={backup.id} className="flex items-center gap-3 px-3 py-2 text-xs">
          <div className="flex min-w-0 flex-1 flex-col">
            <span>{new Date(backup.createdAt).toLocaleString()}</span>
            <span className="text-muted-foreground">
              {formatBytes(backup.sizeBytes)}
              {backup.keyFingerprint !== currentFingerprint &&
                ' · different recovery key'}
            </span>
          </div>
          <button
            type="button"
            disabled={disabled}
            title="Restore"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-60"
            onClick={() => onRestore(backup)}
          >
            {restoring ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconCloudDownload className="size-3.5" />
            )}
            Restore
          </button>
          <button
            type="button"
            disabled={disabled}
            title="Delete"
            className="text-muted-foreground hover:text-destructive disabled:opacity-60"
            onClick={() => onDelete(backup)}
          >
            <IconTrash className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
