import {
  IconArrowUp,
  IconBrandGithub,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { open as openDialog, ask, message } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState } from 'react';

import { ConsentScreen } from '@/components/extension/consent';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group';
import { Separator } from '@/components/ui/separator';
import {
  cleanupExtensionFetch,
  stageExtensionConfigure,
  stageExtensionInstall,
  stageExtensionInstallFromGithub,
  updateSourceUrl
} from '@/extensions/install';
import type { ExtensionUpdateResult } from '@/extensions/install';
import { type StagedExtensionInstall } from '@/extensions/manifest';
import { extensionNeedsSetup } from '@/extensions/needs-setup';
import {
  extensionDevClientsQueryOptions,
  useCreateExtensionDevCode,
  useRevokeExtensionDevClient,
  type ExtensionDevClient
} from '@/hooks/queries/extension-dev';
import {
  extensionBindingsQueryOptions,
  extensionsQueryOptions,
  useCheckExtensionUpdates,
  useSetExtensionEnabled,
  useUninstallExtension,
  type InstalledExtension
} from '@/hooks/queries/extensions';

export function ExtensionsPage() {
  const { data: extensions = [], isLoading } = useQuery(extensionsQueryOptions);
  const { data: bindings = [] } = useQuery(extensionBindingsQueryOptions);
  const [installError, setInstallError] = useState<string | null>(null);
  const [pendingConsent, setPendingConsent] = useState<StagedExtensionInstall | null>(
    null
  );
  const [urlForm, setUrlForm] = useState<{ url: string; fetching: boolean } | null>(null);
  const [updateResults, setUpdateResults] = useState<
    Record<string, ExtensionUpdateResult>
  >({});
  const checkUpdates = useCheckExtensionUpdates();
  const hasUpdatableExtensions = extensions.some((p) => updateSourceUrl(p) !== null);

  function handleCheckUpdates() {
    setInstallError(null);
    checkUpdates.mutate(extensions, {
      onSuccess: (results) => setUpdateResults(results),
      onError: (err) => {
        setInstallError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function handleUpdate(url: string) {
    setInstallError(null);
    try {
      const staged = await stageExtensionInstallFromGithub(url);
      setPendingConsent(staged);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePick() {
    setInstallError(null);
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (!picked || typeof picked !== 'string') return;
      const staged = await stageExtensionInstall(picked, {
        kind: 'local',
        sourcePath: picked
      });
      setPendingConsent(staged);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleFetchFromUrl() {
    if (!urlForm) return;
    const url = urlForm.url.trim();
    if (!url) return;
    setInstallError(null);
    setUrlForm({ url, fetching: true });
    try {
      const staged = await stageExtensionInstallFromGithub(url);
      setUrlForm(null);
      setPendingConsent(staged);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
      setUrlForm({ url, fetching: false });
    }
  }

  async function handleConfigure(extensionId: string) {
    setInstallError(null);
    try {
      const staged = await stageExtensionConfigure(extensionId);
      setPendingConsent(staged);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleConsentClose() {
    const staged = pendingConsent;
    setPendingConsent(null);
    if (staged?.provenance.kind === 'github') {
      void cleanupExtensionFetch(staged.sourcePath).catch(() => {});
    }
  }

  if (pendingConsent) {
    return (
      <ConsentScreen
        key={pendingConsent.sourcePath}
        staged={pendingConsent}
        onClose={handleConsentClose}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 bg-background pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Extensions</h2>
          <div className="flex flex-wrap gap-2">
            {hasUpdatableExtensions && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCheckUpdates}
                disabled={checkUpdates.isPending}
                title="Check installed extensions for newer versions"
              >
                <IconRefresh
                  className={`size-4 ${checkUpdates.isPending ? 'animate-spin' : ''}`}
                />
                {checkUpdates.isPending ? 'Checking…' : 'Check for updates'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setInstallError(null);
                setUrlForm((cur) => (cur ? null : { url: '', fetching: false }));
              }}
            >
              <IconBrandGithub className="size-4" />
              Install from GitHub
            </Button>
            <Button size="sm" onClick={() => void handlePick()}>
              <IconPlus className="size-4" />
              Install from folder
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Install extensions from a local folder or a GitHub URL.
        </p>
      </div>

      {urlForm && (
        <Field orientation="vertical" className="mb-3 gap-2 border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <FieldLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              GitHub URL
            </FieldLabel>
            <button
              type="button"
              onClick={() => setUrlForm(null)}
              disabled={urlForm.fetching}
              aria-label="Cancel"
              className="-mt-1 -mr-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <IconX className="size-4" />
            </button>
          </div>

          <InputGroup>
            <InputGroupInput
              type="url"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              placeholder="https://github.com/owner/repo/tree/main/my-extension"
              value={urlForm.url}
              disabled={urlForm.fetching}
              onChange={(e) => setUrlForm({ ...urlForm, url: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleFetchFromUrl();
                }
              }}
              className="font-mono"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                variant="primary"
                onClick={() => void handleFetchFromUrl()}
                disabled={urlForm.fetching}
              >
                {urlForm.fetching ? 'Installing…' : 'Install'}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      )}

      {installError && (
        <p className="pb-3 text-xs wrap-break-word text-destructive">{installError}</p>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>
        ) : extensions.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No extensions installed. Install one from a folder containing a{' '}
            <code>manifest.json</code>.
          </p>
        ) : (
          extensions.map((extension) => (
            <ExtensionRow
              key={extension.id}
              extension={extension}
              bindings={bindings.filter((b) => b.extensionId === extension.id)}
              updateResult={updateResults[extension.id]}
              onConfigure={() => void handleConfigure(extension.id)}
              onUpdate={(url) => void handleUpdate(url)}
            />
          ))
        )}
      </div>

      <ExtensionDevSection />
    </div>
  );
}

function ExtensionDevSection() {
  const { data: clients = [] } = useQuery(extensionDevClientsQueryOptions);
  const createCode = useCreateExtensionDevCode();
  const revoke = useRevokeExtensionDevClient();
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(
    null
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!pairing) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pairing]);

  const remainingSecs = pairing
    ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000))
    : 0;

  useEffect(() => {
    if (pairing && remainingSecs === 0) setPairing(null);
  }, [pairing, remainingSecs]);

  const baselineClientsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!pairing) {
      baselineClientsRef.current = null;
      return;
    }
    if (baselineClientsRef.current === null) {
      baselineClientsRef.current = clients.length;
    } else if (clients.length > baselineClientsRef.current) {
      setPairing(null);
    }
  }, [pairing, clients.length]);

  async function handleStartPairing() {
    try {
      const result = await createCode.mutateAsync();
      setPairing(result);
    } catch (err) {
      void message(err instanceof Error ? err.message : String(err), {
        title: 'Pairing failed',
        kind: 'error'
      });
    }
  }

  async function handleRevoke(client: ExtensionDevClient) {
    const ok = await ask(`Revoke dev pairing for ${client.extensionId}?`, {
      title: 'Revoke pairing',
      kind: 'warning',
      okLabel: 'Revoke',
      cancelLabel: 'Cancel'
    });
    if (ok) revoke.mutate(client.extensionId);
  }

  const active = clients.filter((c) => !c.revokedAt);
  const [expanded, setExpanded] = useState(false);
  const showFull = active.length > 0 || expanded;

  if (!showFull) {
    return (
      <div className="mt-auto flex justify-end pt-8">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Enable extension dev mode
        </button>
        <PairingDialog
          pairing={pairing}
          remainingSecs={remainingSecs}
          onClose={() => setPairing(null)}
        />
      </div>
    );
  }

  return (
    <>
      <Separator className="my-8" />
      <div>
        <div className="flex items-start justify-between gap-3 pb-3">
          <div>
            <h2 className="text-sm font-medium">Extension development</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Pair the <code>branch-fiction-extension-dev</code> CLI to iterate on
              extensions outside the app.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => void handleStartPairing()}
            disabled={createCode.isPending}
          >
            <IconPlus className="size-4" />
            Pair new dev client
          </Button>
        </div>

        {active.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No paired dev clients.
          </p>
        ) : (
          <div className="space-y-2">
            {active.map((client) => (
              <div
                key={client.extensionId}
                className="flex items-center justify-between gap-3 border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{client.extensionId}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Paired {client.createdAt}
                    {client.lastUsedAt && <> · last used {client.lastUsedAt}</>}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="icon-xs"
                  onClick={() => void handleRevoke(client)}
                  disabled={revoke.isPending}
                >
                  <IconTrash className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <PairingDialog
          pairing={pairing}
          remainingSecs={remainingSecs}
          onClose={() => setPairing(null)}
        />
      </div>
    </>
  );
}

function PairingDialog({
  pairing,
  remainingSecs,
  onClose
}: {
  pairing: { code: string; expiresAt: number } | null;
  remainingSecs: number;
  onClose: () => void;
}) {
  return (
    <Dialog open={pairing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pair dev client</DialogTitle>
          <DialogDescription>
            Enter this code in the extension dev CLI to pair it with this app. The code
            expires in {remainingSecs}s.
          </DialogDescription>
        </DialogHeader>
        <div className="my-4 flex justify-center">
          <code className="rounded-md bg-muted px-4 py-3 font-mono text-sm break-all select-all">
            {pairing?.code ?? ''}
          </code>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExtensionRow({
  extension,
  bindings,
  updateResult,
  onConfigure,
  onUpdate
}: {
  extension: InstalledExtension;
  bindings: { providerKey: string }[];
  updateResult?: ExtensionUpdateResult;
  onConfigure: () => void;
  onUpdate: (url: string) => void;
}) {
  const setEnabled = useSetExtensionEnabled();
  const uninstall = useUninstallExtension();
  const needsConfig = extensionNeedsSetup(extension.manifest, extension.config, bindings);

  function handleUninstall() {
    void (async () => {
      const confirmed = await ask(
        `Uninstall ${extension.name}? Its files and saved data will be removed.`,
        {
          title: 'Uninstall extension',
          kind: 'warning',
          okLabel: 'Uninstall',
          cancelLabel: 'Cancel'
        }
      );
      if (confirmed) uninstall.mutate(extension.id);
    })();
  }

  return (
    <div className="min-w-0 border border-border">
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{extension.name}</h3>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {extension.id} · v{extension.version}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {needsConfig ? (
            <span className="text-xs text-warning">Configure to enable</span>
          ) : (
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={extension.enabled}
                onCheckedChange={(v) =>
                  setEnabled.mutate({ id: extension.id, enabled: v === true })
                }
              />
              Enabled
            </label>
          )}
          {updateResult?.kind === 'update' && (
            <Button
              size="xs"
              variant="primary"
              onClick={() => onUpdate(updateResult.url)}
              title={`Installed v${updateResult.current} → remote v${updateResult.latest}`}
            >
              <IconArrowUp className="size-3.5" />
              Update to v{updateResult.latest}
            </Button>
          )}
          {updateResult?.kind === 'up-to-date' && (
            <span className="text-[11px] text-muted-foreground" title="Up to date">
              Up to date
            </span>
          )}
          {updateResult?.kind === 'error' && (
            <span className="text-[11px] text-destructive" title={updateResult.message}>
              Check failed
            </span>
          )}
          {(extension.manifest.providers?.length ?? 0) > 0 && (
            <Button variant="secondary" size="xs" onClick={onConfigure}>
              Configure
            </Button>
          )}
          {extension.provenanceType !== 'bundled' && (
            <Button
              variant="destructive"
              size="icon-xs"
              onClick={handleUninstall}
              disabled={uninstall.isPending}
            >
              <IconTrash className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
