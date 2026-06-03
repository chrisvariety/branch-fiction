import { getModels } from '@earendil-works/pi-ai';
import {
  IconArrowUp,
  IconBrandGithub,
  IconChevronLeft,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconServer,
  IconTrash,
  IconX
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { open as openDialog, ask, message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  cleanupExtensionFetch,
  stageExtensionConfigure,
  stageExtensionInstall,
  stageExtensionInstallFromGithub,
  updateSourceUrl
} from '@/extensions/install';
import type { CommitInstallArgs, ExtensionUpdateResult } from '@/extensions/install';
import {
  defaultsFromManifest,
  hasMissingConfigFields,
  isOptionalRequirement,
  optionExpectsUserURL,
  optionURL,
  requirementHasModel,
  type ExtensionProvenance,
  type ExtensionConfigField,
  type ExtensionProviderOption,
  type ExtensionProviderRequirementOptions,
  type ResolvedOption,
  type ResolvedRequirement,
  type ResolvedSlot,
  type SlotCandidate,
  type StagedExtensionInstall
} from '@/extensions/manifest';
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
  useCommitExtensionInstall,
  useSetExtensionEnabled,
  useUninstallExtension,
  type InstalledExtension
} from '@/hooks/queries/extensions';
import { CLOUD_PROVIDER_TYPE } from '@/lib/cloud';
import {
  getProviderEntry,
  getProviderEntryByOriginAndAuth,
  SLOT_LABELS
} from '@/lib/llm/providers';

const openExternalLink = (url: string) => void openUrl(url);

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
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-background pb-4">
        <div>
          <h2 className="text-sm font-medium">Extensions</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Install extensions from a local folder or a GitHub URL.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
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

type CredentialDraft = { name: string; secret: string; baseUrl: string };

type RequirementState = {
  optionIndex: number;
  modelKeys: Record<number, string>;
  useNewCredential: Record<number, boolean>;
};

function newCredentialResolution(
  option: ExtensionProviderOption
): Extract<ResolvedOption, { kind: 'preset' | 'unknown' }> {
  const url = optionURL(option);
  const preset = getProviderEntryByOriginAndAuth(url, option.auth);
  if (preset) return { kind: 'preset', presetType: preset.type, presetName: preset.name };
  let suggestedName = option.providerName ?? '';
  if (!suggestedName) {
    try {
      suggestedName = new URL(url).hostname;
    } catch {
      suggestedName = '';
    }
  }
  return { kind: 'unknown', suggestedName };
}

function effectiveResolvedOption(
  option: ExtensionProviderOption,
  base: ResolvedOption,
  useNewCredential: boolean
): ResolvedOption {
  if (useNewCredential && base.kind === 'existing')
    return newCredentialResolution(option);
  return base;
}

function credentialDedupeKey(option: ExtensionProviderOption): string {
  const url = optionURL(option);
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = url;
  }
  return `${origin}|${JSON.stringify(option.auth)}`;
}

function isValidURL(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function resolvedOptionProviderType(o: ResolvedOption): string {
  if (o.kind === 'existing') return o.providerType;
  if (o.kind === 'preset') return o.presetType;
  return 'custom';
}

function isCloudBound(o: ResolvedOption): boolean {
  return o.kind === 'existing' && o.providerType === CLOUD_PROVIDER_TYPE;
}

function lookupModelName(providerType: string, modelKey: string): string {
  const piProvider = getProviderEntry(providerType)?.piProvider;
  if (!piProvider) return modelKey;
  const match = getModels(piProvider).find((m) => m.id === modelKey);
  return match?.name ?? modelKey;
}

function initialRequirementState(r: {
  requirement: ExtensionProviderRequirementOptions;
  options: ResolvedOption[];
  binding?: { providerId: string; modelKey: string | null };
}): RequirementState {
  const modelKeys: Record<number, string> = {};
  r.options.forEach((_opt, i) => {
    modelKeys[i] = r.requirement.options[i]!.model ?? '';
  });
  const boundIdx = r.binding
    ? r.options.findIndex(
        (o) => o.kind === 'existing' && o.providerId === r.binding!.providerId
      )
    : -1;
  if (boundIdx >= 0) {
    if (r.binding!.modelKey) modelKeys[boundIdx] = r.binding!.modelKey;
    return { optionIndex: boundIdx, modelKeys, useNewCredential: {} };
  }
  // Optional providers default to "None" (no option selected) until the user picks one.
  if (isOptionalRequirement(r.requirement)) {
    return { optionIndex: -1, modelKeys, useNewCredential: {} };
  }
  const existingIdx = r.options.findIndex((o) => o.kind === 'existing');
  const optionIndex = existingIdx >= 0 ? existingIdx : 0;
  return { optionIndex, modelKeys, useNewCredential: {} };
}

function initialCredentialDrafts(
  optionsReqs: OptionsRequirement[]
): Record<string, CredentialDraft> {
  const seed: Record<string, CredentialDraft> = {};
  for (const r of optionsReqs) {
    r.options.forEach((resolved, i) => {
      if (resolved.kind === 'existing') return;
      const option = r.requirement.options[i]!;
      const key = credentialDedupeKey(option);
      if (key in seed) return;
      const name =
        resolved.kind === 'preset'
          ? resolved.presetName
          : (option.providerName ?? resolved.suggestedName);

      const baseUrl = optionExpectsUserURL(option) ? '' : optionURL(option);
      seed[key] = { name, secret: '', baseUrl };
    });
  }
  return seed;
}

type OptionsRequirement = Extract<ResolvedRequirement, { options: ResolvedOption[] }>;
type SlotRequirement = Extract<ResolvedRequirement, { slot: ResolvedSlot }>;

function isOptionsResolved(r: ResolvedRequirement): r is OptionsRequirement {
  return 'options' in r;
}

function ConsentScreen({
  staged,
  onClose
}: {
  staged: StagedExtensionInstall;
  onClose: () => void;
}) {
  const commit = useCommitExtensionInstall();
  const isPending = commit.isPending;

  const { manifest } = staged;

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const optionsReqs = staged.requirements.filter(isOptionsResolved);
  const slotReqs = staged.requirements.filter(
    (r): r is SlotRequirement => !isOptionsResolved(r)
  );

  const [reqStates, setReqStates] = useState<Record<string, RequirementState>>(() =>
    Object.fromEntries(
      optionsReqs.map((r) => [r.requirement.key, initialRequirementState(r)])
    )
  );

  const [credentialDrafts, setCredentialDrafts] = useState<
    Record<string, CredentialDraft>
  >(() => initialCredentialDrafts(optionsReqs));

  // Optional providers default to "None" (optionIndex < 0) and are skipped at commit time.
  const activeOptionsReqs = optionsReqs.filter(
    (r) => (reqStates[r.requirement.key]?.optionIndex ?? 0) >= 0
  );

  const configFields = manifest.config ?? [];
  const [configDraft, setConfigDraft] = useState<Record<string, unknown>>(() => ({
    ...defaultsFromManifest(manifest),
    ...(staged.existingConfig ?? {})
  }));

  // Selected text-model (provider_model id) per useSlot area.
  const [slotSelections, setSlotSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      slotReqs.flatMap((r) =>
        r.slot.kind === 'configured'
          ? [[r.requirement.key, r.slot.selectedProviderModelId]]
          : []
      )
    )
  );

  type Pick = {
    r: OptionsRequirement;
    optionIndex: number;
    resolved: ResolvedOption;
    option: ExtensionProviderOption;
  };

  const picks: Pick[] = activeOptionsReqs.map((r) => {
    const state = reqStates[r.requirement.key]!;
    const optionIndex = state.optionIndex;
    const option = r.requirement.options[optionIndex]!;
    const resolved = effectiveResolvedOption(
      option,
      r.options[optionIndex]!,
      state.useNewCredential[optionIndex] ?? false
    );
    return { r, optionIndex, resolved, option };
  });

  const bindingReqs = activeOptionsReqs.filter(
    (r) =>
      !requirementHasModel(r.requirement) &&
      r.requirement.options.length === 1 &&
      r.options[0]!.kind === 'existing'
  );

  type CredentialGroup = {
    dedupeKey: string;
    primaryOption: ExtensionProviderOption;
    primaryResolved: Extract<ResolvedOption, { kind: 'preset' | 'unknown' }>;
    roles: string[];
  };
  const credentialGroups: CredentialGroup[] = [];
  const groupsByKey = new Map<string, CredentialGroup>();
  for (const p of picks) {
    if (p.resolved.kind === 'existing') continue;
    const dedupeKey = credentialDedupeKey(p.option);
    const role = p.r.requirement.role ?? p.r.requirement.key;
    const existing = groupsByKey.get(dedupeKey);
    if (existing) {
      existing.roles.push(role);
      continue;
    }
    const group: CredentialGroup = {
      dedupeKey,
      primaryOption: p.option,
      primaryResolved: p.resolved,
      roles: [role]
    };
    groupsByKey.set(dedupeKey, group);
    credentialGroups.push(group);
  }

  const requirementsReady =
    !hasMissingConfigFields(manifest, configDraft) &&
    slotReqs.every((r) => r.slot.kind === 'configured') &&
    picks.every((p) => {
      if (!requirementHasModel(p.r.requirement)) return true;
      const modelKey = reqStates[p.r.requirement.key]!.modelKeys[p.optionIndex] ?? '';
      return modelKey.trim().length > 0;
    }) &&
    credentialGroups.every((g) => {
      const cred = credentialDrafts[g.dedupeKey];
      if (!cred) return false;
      if (cred.name.trim().length === 0) return false;
      if (cred.secret.length === 0) return false;
      if (optionExpectsUserURL(g.primaryOption) && !isValidURL(cred.baseUrl.trim())) {
        return false;
      }
      return true;
    });

  const hasNetEntries = (manifest.net?.length ?? 0) > 0;
  const isConfigure = staged.mode === 'configure';
  const installLabel = staged.isReinstall ? 'Reinstall extension' : 'Install extension';
  const headingVerb = isConfigure
    ? 'Configure'
    : staged.isReinstall
      ? 'Reinstall'
      : 'Install';

  function setOptionIndex(reqKey: string, nextIndex: number) {
    setReqStates((prev) => ({
      ...prev,
      [reqKey]: { ...prev[reqKey]!, optionIndex: nextIndex }
    }));
  }

  function setConfigValue(key: string, value: unknown) {
    setConfigDraft((prev) => ({ ...prev, [key]: value }));
  }

  function setSlotProvider(reqKey: string, providerModelId: string) {
    setSlotSelections((prev) => ({ ...prev, [reqKey]: providerModelId }));
  }

  function setUseNewCredential(
    reqKey: string,
    optionIndex: number,
    option: ExtensionProviderOption,
    useNew: boolean
  ) {
    setReqStates((prev) => {
      const state = prev[reqKey]!;
      return {
        ...prev,
        [reqKey]: {
          ...state,
          useNewCredential: { ...state.useNewCredential, [optionIndex]: useNew }
        }
      };
    });
    if (!useNew) return;
    setCredentialDrafts((prev) => {
      const dedupeKey = credentialDedupeKey(option);
      if (prev[dedupeKey]) return prev;
      const eff = newCredentialResolution(option);
      const name =
        eff.kind === 'preset'
          ? eff.presetName
          : (option.providerName ?? eff.suggestedName);
      const baseUrl = optionExpectsUserURL(option) ? '' : optionURL(option);
      return { ...prev, [dedupeKey]: { name, secret: '', baseUrl } };
    });
  }

  function setCredential(dedupeKey: string, patch: Partial<CredentialDraft>) {
    setCredentialDrafts((prev) => {
      const existing = prev[dedupeKey] ?? { name: '', secret: '' };
      return { ...prev, [dedupeKey]: { ...existing, ...patch } };
    });
  }

  function setModelKey(reqKey: string, optionIndex: number, modelKey: string) {
    setReqStates((prev) => {
      const state = prev[reqKey]!;
      return {
        ...prev,
        [reqKey]: {
          ...state,
          modelKeys: { ...state.modelKeys, [optionIndex]: modelKey }
        }
      };
    });
  }

  function handleSubmit() {
    setSubmitError(null);
    try {
      const requirements: CommitInstallArgs['requirements'] = picks.map((p) => {
        const wantsModel = requirementHasModel(p.r.requirement);
        const stateModel = reqStates[p.r.requirement.key]!.modelKeys[p.optionIndex] ?? '';
        const modelKey = wantsModel ? stateModel.trim() || undefined : undefined;
        if (p.resolved.kind === 'existing') {
          return {
            kind: 'existing',
            providerKey: p.r.requirement.key,
            optionIndex: p.optionIndex,
            providerId: p.resolved.providerId,
            modelKey,
            overrideBaseUrl: p.resolved.overrideBaseUrl
          };
        }
        const cred = credentialDrafts[credentialDedupeKey(p.option)]!;
        const baseUrl = cred.baseUrl.trim() || optionURL(p.option);
        if (p.resolved.kind === 'preset') {
          return {
            kind: 'preset',
            providerKey: p.r.requirement.key,
            optionIndex: p.optionIndex,
            baseUrl,
            name: cred.name,
            secret: cred.secret,
            modelKey
          };
        }
        return {
          kind: 'unknown',
          providerKey: p.r.requirement.key,
          optionIndex: p.optionIndex,
          baseUrl,
          name: cred.name,
          secret: cred.secret,
          modelKey
        };
      });
      const slotBindings = slotReqs.flatMap((r) => {
        if (r.slot.kind !== 'configured') return [];
        const selectedId =
          slotSelections[r.requirement.key] ?? r.slot.selectedProviderModelId;
        const candidate = r.slot.candidates.find((c) => c.providerModelId === selectedId);
        if (!candidate) return [];
        return [
          {
            providerKey: r.requirement.key,
            providerId: candidate.providerId,
            modelKey: candidate.modelKey
          }
        ];
      });
      commit.mutate(
        {
          sourcePath: staged.sourcePath,
          expectedId: manifest.id,
          requirements,
          config: configDraft,
          slotBindings,
          mode: staged.mode,
          provenance: staged.provenance
        },
        {
          onSuccess: onClose,
          onError: (err) => {
            const detail = err instanceof Error ? err.message : String(err);
            setSubmitError(detail);
            void message(detail, { title: 'Install failed', kind: 'error' });
          }
        }
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }

  const canInstall = requirementsReady && !isPending;

  return (
    <div className="flex flex-col pb-6">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-background pb-4">
        <div className="min-w-0">
          {isConfigure && (
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="mb-1 flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <IconChevronLeft className="size-3.5" />
              Back
            </button>
          )}
          <h2 className="text-sm font-medium">
            {headingVerb} {manifest.name}
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {manifest.id} · v{manifest.version}
            {manifest.author && <> · by {manifest.author}</>}
          </p>
          {staged.provenance && <ProvenanceLine provenance={staged.provenance} />}
          {manifest.description && (
            <ExpandableDescription>{manifest.description}</ExpandableDescription>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {isConfigure ? (
            <Button size="sm" onClick={handleSubmit} disabled={isPending || !canInstall}>
              {isPending ? 'Saving…' : 'Done'}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 text-xs">
        {staged.isReinstall && !isConfigure && (
          <p className="border border-border bg-muted/50 p-2 text-muted-foreground">
            An extension with this id is already installed. Continuing replaces the files;
            the existing config and provider bindings are preserved where possible.
          </p>
        )}

        {configFields.length > 0 && (
          <ConfigBox
            fields={configFields}
            draft={configDraft}
            onChange={setConfigValue}
          />
        )}

        {staged.requirements.length > 0 && (
          <ModelsBox
            optionsReqs={optionsReqs}
            slotReqs={slotReqs}
            reqStates={reqStates}
            slotSelections={slotSelections}
            showAdvanced={showAdvanced}
            onToggleAdvanced={() => setShowAdvanced((v) => !v)}
            onSetOptionIndex={setOptionIndex}
            onSetModelKey={setModelKey}
            onSetSlotProvider={setSlotProvider}
            onSetUseNewCredential={setUseNewCredential}
          />
        )}

        {bindingReqs.length > 0 && (
          <ProviderBindingBox
            reqs={bindingReqs}
            reqStates={reqStates}
            onChangeCredentialSource={setUseNewCredential}
          />
        )}

        {credentialGroups.map((g) => (
          <CredentialBox
            key={g.dedupeKey}
            group={g}
            draft={
              credentialDrafts[g.dedupeKey] ?? {
                name:
                  g.primaryResolved.kind === 'preset'
                    ? g.primaryResolved.presetName
                    : (g.primaryOption.providerName ?? g.primaryResolved.suggestedName),
                secret: '',
                baseUrl: optionExpectsUserURL(g.primaryOption)
                  ? ''
                  : optionURL(g.primaryOption)
              }
            }
            onChange={(patch) => setCredential(g.dedupeKey, patch)}
          />
        ))}

        {hasNetEntries && (
          <div className="border border-border p-3">
            <h4 className="pt-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Network access
            </h4>
            <p className="mt-1 mb-2">May connect to the following hosts:</p>
            <ul className="mt-1 ml-4 list-disc font-mono text-muted-foreground">
              {manifest.net!.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        )}

        {submitError && (
          <p className="text-xs wrap-break-word text-destructive">{submitError}</p>
        )}
        {!isConfigure && (
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={handleSubmit} disabled={!canInstall}>
              {isPending ? 'Installing…' : installLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ModelsBox({
  optionsReqs,
  slotReqs,
  reqStates,
  slotSelections,
  showAdvanced,
  onToggleAdvanced,
  onSetOptionIndex,
  onSetModelKey,
  onSetSlotProvider,
  onSetUseNewCredential
}: {
  optionsReqs: OptionsRequirement[];
  slotReqs: SlotRequirement[];
  reqStates: Record<string, RequirementState>;
  slotSelections: Record<string, string>;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onSetOptionIndex: (reqKey: string, nextIndex: number) => void;
  onSetModelKey: (reqKey: string, optionIndex: number, modelKey: string) => void;
  onSetSlotProvider: (reqKey: string, providerModelId: string) => void;
  onSetUseNewCredential: (
    reqKey: string,
    optionIndex: number,
    option: ExtensionProviderOption,
    useNew: boolean
  ) => void;
}) {
  const visibleOptionsReqs = optionsReqs.filter(
    (r) => requirementHasModel(r.requirement) || r.requirement.options.length > 1
  );
  const optionsEditable = visibleOptionsReqs.some((r) => {
    if (r.requirement.options.length > 1) return true;
    const idx = reqStates[r.requirement.key]!.optionIndex;
    if (idx < 0) return true;
    return requirementHasModel(r.requirement) && !isCloudBound(r.options[idx]!);
  });
  const slotEditable = slotReqs.some(
    (r) => r.slot.kind === 'configured' && r.slot.candidates.length > 1
  );
  const editable = optionsEditable || slotEditable;
  const total = visibleOptionsReqs.length + slotReqs.length;
  if (total === 0) return null;
  const heading =
    total === 1
      ? 'The extension uses the following model:'
      : 'The extension uses the following models:';

  const rows: { key: string; node: React.ReactNode }[] = [
    ...slotReqs.map((r) => ({
      key: `s:${r.requirement.key}`,
      node: (
        <SlotModelRow
          resolved={r}
          showAdvanced={showAdvanced}
          selectedProviderModelId={
            slotSelections[r.requirement.key] ??
            (r.slot.kind === 'configured' ? r.slot.selectedProviderModelId : null)
          }
          onSelect={(id) => onSetSlotProvider(r.requirement.key, id)}
        />
      )
    })),
    ...visibleOptionsReqs.map((r) => ({
      key: `o:${r.requirement.key}`,
      node: (
        <OptionModelRow
          req={r}
          state={reqStates[r.requirement.key]!}
          showAdvanced={showAdvanced}
          onChangeOption={(i) => onSetOptionIndex(r.requirement.key, i)}
          onChangeModel={(modelKey) =>
            onSetModelKey(
              r.requirement.key,
              reqStates[r.requirement.key]!.optionIndex,
              modelKey
            )
          }
          onChangeCredentialSource={(i, useNew) =>
            onSetUseNewCredential(r.requirement.key, i, r.requirement.options[i]!, useNew)
          }
        />
      )
    }))
  ];

  return (
    <div className="flex flex-col gap-2 border border-border p-3">
      <p className="mb-2">{heading}</p>
      <div className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1.5">
        {rows.map((row, i) => (
          <Fragment key={row.key}>
            {row.node}
            {showAdvanced && i < rows.length - 1 && (
              <Separator className="col-span-2 my-1" />
            )}
          </Fragment>
        ))}
      </div>
      {editable && (
        <button
          type="button"
          className="w-auto! self-start pt-1 text-left text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={onToggleAdvanced}
        >
          {showAdvanced ? 'Hide options' : 'Configure models'}
        </button>
      )}
    </div>
  );
}

// `useSlot` area: defaults to app text model, overridable per extension.
function candidateLabel(c: SlotCandidate): string {
  if (c.providerType === CLOUD_PROVIDER_TYPE) return c.providerName;
  return `${c.providerName} · ${lookupModelName(c.providerType, c.modelKey)}`;
}

function SlotModelRow({
  resolved,
  selectedProviderModelId,
  onSelect,
  showAdvanced
}: {
  resolved: SlotRequirement;
  selectedProviderModelId: string | null;
  onSelect: (providerModelId: string) => void;
  showAdvanced: boolean;
}) {
  const role = resolved.requirement.role ?? resolved.requirement.key;
  const slotLabel = SLOT_LABELS[resolved.requirement.useSlot];
  if (resolved.slot.kind === 'empty') {
    return (
      <>
        <span className="text-muted-foreground">{role}</span>
        <span className="text-warning">
          No {slotLabel.toLowerCase()} configured — add one in Settings → Providers.
        </span>
      </>
    );
  }
  const { candidates } = resolved.slot;
  const current =
    candidates.find((c) => c.providerModelId === selectedProviderModelId) ??
    candidates[0]!;

  if (candidates.length <= 1 || !showAdvanced) {
    return (
      <>
        <span className="text-muted-foreground">{role}</span>
        <span className="font-medium">{candidateLabel(current)}</span>
      </>
    );
  }

  return (
    <>
      <span className="text-muted-foreground">{role}</span>
      <Select value={current.providerModelId} onValueChange={(v) => v && onSelect(v)}>
        <SelectTrigger size="sm">
          <SelectValue>{candidateLabel(current)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {candidates.map((c) => (
            <SelectItem key={c.providerModelId} value={c.providerModelId}>
              {candidateLabel(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function optionUpstreamLabel(option: ExtensionProviderOption): string {
  const url = optionURL(option);
  const preset = getProviderEntryByOriginAndAuth(url, option.auth);
  if (preset) return preset.name;
  if (option.providerName) return option.providerName;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function providerLabelFor(
  option: ExtensionProviderOption,
  resolved: ResolvedOption
): string {
  if (resolved.kind === 'existing') {
    if (resolved.providerType === CLOUD_PROVIDER_TYPE) {
      return `${optionUpstreamLabel(option)} (Cloud)`;
    }
    return resolved.providerName;
  }
  if (resolved.kind === 'preset') return resolved.presetName;
  return option.providerName ?? resolved.suggestedName;
}

function OptionModelRow({
  req,
  state,
  showAdvanced,
  onChangeOption,
  onChangeModel,
  onChangeCredentialSource
}: {
  req: OptionsRequirement;
  state: RequirementState;
  showAdvanced: boolean;
  onChangeOption: (nextIndex: number) => void;
  onChangeModel: (modelKey: string) => void;
  onChangeCredentialSource: (optionIndex: number, useNew: boolean) => void;
}) {
  const role = req.requirement.role ?? req.requirement.key;
  const optional = isOptionalRequirement(req.requirement);
  const optionIndex = state.optionIndex;
  const isNone = optionIndex < 0;
  const wantsModel = requirementHasModel(req.requirement);

  // Option-dependent values only resolve when a real option is selected.
  const useNew = isNone ? false : (state.useNewCredential[optionIndex] ?? false);
  const option = isNone ? null : req.requirement.options[optionIndex]!;
  const resolved =
    option && !isNone
      ? effectiveResolvedOption(option, req.options[optionIndex]!, useNew)
      : null;
  const providerType = resolved ? resolvedOptionProviderType(resolved) : '';
  const currentModel = isNone ? '' : (state.modelKeys[optionIndex] ?? '');
  const cloudBound = resolved ? isCloudBound(resolved) : false;

  if (!showAdvanced) {
    const display = isNone
      ? 'None'
      : currentModel
        ? lookupModelName(providerType, currentModel)
        : '—';
    return (
      <>
        <span className="text-muted-foreground">{role}</span>
        <span className="font-medium">{display}</span>
      </>
    );
  }

  const choices = [
    ...(optional ? [{ value: 'none', label: 'None' }] : []),
    ...req.requirement.options.flatMap((opt, i) => {
      const base = req.options[i]!;
      const entries = [{ value: `opt:${i}`, label: providerLabelFor(opt, base) }];
      if (base.kind === 'existing' && base.providerType === CLOUD_PROVIDER_TYPE) {
        entries.push({ value: `new:${i}`, label: optionUpstreamLabel(opt) });
      }
      return entries;
    })
  ];

  const selectValue = isNone
    ? 'none'
    : useNew
      ? `new:${optionIndex}`
      : `opt:${optionIndex}`;
  const triggerLabel = isNone
    ? 'None'
    : useNew
      ? optionUpstreamLabel(option!)
      : providerLabelFor(option!, resolved!);

  return (
    <>
      <span className="text-muted-foreground">{role}</span>
      <div className="flex flex-col gap-1.5">
        {choices.length > 1 && (
          <Select
            value={selectValue}
            onValueChange={(v) => {
              if (!v) return;
              if (v === 'none') {
                onChangeOption(-1);
                return;
              }
              const wantsNew = v.startsWith('new:');
              const i = Number(v.slice(v.indexOf(':') + 1));
              onChangeOption(i);
              onChangeCredentialSource(i, wantsNew);
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue>{triggerLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {choices.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {/* Cloud serves its own model for the role; only BYO providers pick one. */}
        {!isNone && wantsModel && !cloudBound && (
          <ModelPicker
            providerType={providerType}
            value={currentModel}
            onChange={onChangeModel}
          />
        )}
      </div>
    </>
  );
}

function ProviderBindingBox({
  reqs,
  reqStates,
  onChangeCredentialSource
}: {
  reqs: OptionsRequirement[];
  reqStates: Record<string, RequirementState>;
  onChangeCredentialSource: (
    reqKey: string,
    optionIndex: number,
    option: ExtensionProviderOption,
    useNew: boolean
  ) => void;
}) {
  const heading =
    reqs.length === 1
      ? 'The extension connects to the following provider:'
      : 'The extension connects to the following providers:';
  return (
    <div className="flex flex-col gap-2 border border-border p-3">
      <p className="mb-2">{heading}</p>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
        {reqs.map((r) => {
          const role = r.requirement.role ?? r.requirement.key;
          const state = reqStates[r.requirement.key]!;
          const optionIndex = state.optionIndex;
          const option = r.requirement.options[optionIndex]!;
          const base = r.options[optionIndex]!;
          const existingName =
            base.kind === 'existing' ? providerLabelFor(option, base) : '';
          const newLabel = 'Use a new credential…';
          const useNew = state.useNewCredential[optionIndex] ?? false;
          return (
            <Fragment key={r.requirement.key}>
              <span className="text-muted-foreground">{role}</span>
              <Select
                value={useNew ? '__new__' : '__existing__'}
                onValueChange={(v) => {
                  if (!v) return;
                  onChangeCredentialSource(
                    r.requirement.key,
                    optionIndex,
                    option,
                    v === '__new__'
                  );
                }}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue>
                    {(value) => (value === '__new__' ? newLabel : existingName)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__existing__">{existingName}</SelectItem>
                  <SelectItem value="__new__">{newLabel}</SelectItem>
                </SelectContent>
              </Select>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function ConfigBox({
  fields,
  draft,
  onChange
}: {
  fields: ExtensionConfigField[];
  draft: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border border-border p-3">
      <h4 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Configuration
      </h4>
      {fields.map((field) => (
        <ConfigField
          key={field.key}
          field={field}
          value={draft[field.key]}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
    </div>
  );
}

function ConfigField({
  field,
  value,
  onChange
}: {
  field: ExtensionConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const stringValue = typeof value === 'string' ? value : '';

  if (field.type === 'boolean') {
    return (
      <Field orientation="horizontal">
        <Checkbox
          checked={value === true}
          onCheckedChange={(v) => onChange(v === true)}
        />
        <div className="flex flex-col gap-0.5">
          <FieldLabel>{field.label}</FieldLabel>
          {field.description && (
            <FieldDescription className="text-[11px]" onLinkClick={openExternalLink}>
              {field.description}
            </FieldDescription>
          )}
        </div>
      </Field>
    );
  }

  if (field.type === 'select') {
    return (
      <Field orientation="vertical" className="gap-1.5">
        <FieldLabel>
          {field.label}
          {field.required && <span className="text-warning"> *</span>}
        </FieldLabel>
        <Select value={stringValue} onValueChange={(v) => v && onChange(v)}>
          <SelectTrigger size="sm">
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.description && (
          <FieldDescription className="text-[11px]" onLinkClick={openExternalLink}>
            {field.description}
          </FieldDescription>
        )}
      </Field>
    );
  }

  return (
    <Field orientation="vertical" className="gap-1.5">
      <FieldLabel>
        {field.label}
        {field.required && <span className="text-warning"> *</span>}
      </FieldLabel>
      <Input
        type={field.type === 'url' ? 'url' : 'text'}
        autoComplete="off"
        spellCheck={false}
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={field.type === 'url' ? 'font-mono' : undefined}
      />
      {field.description && (
        <FieldDescription className="text-[11px]" onLinkClick={openExternalLink}>
          {field.description}
        </FieldDescription>
      )}
    </Field>
  );
}

function CredentialBox({
  group,
  draft,
  onChange
}: {
  group: {
    primaryOption: ExtensionProviderOption;
    primaryResolved: Extract<ResolvedOption, { kind: 'preset' | 'unknown' }>;
    roles: string[];
  };
  draft: CredentialDraft;
  onChange: (patch: Partial<CredentialDraft>) => void;
}) {
  const providerLabel =
    group.primaryResolved.kind === 'preset'
      ? group.primaryResolved.presetName
      : (group.primaryOption.providerName ?? group.primaryResolved.suggestedName);
  const expectsUserURL = optionExpectsUserURL(group.primaryOption);
  return (
    <div className="flex flex-col gap-2 border border-border p-3">
      <h4 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {providerLabel}
      </h4>
      <p className="text-[11px] text-muted-foreground">
        Used by: {group.roles.join(', ')}.
      </p>
      <EditableName value={draft.name} onChange={(name) => onChange({ name })} />
      {expectsUserURL && (
        <Input
          type="url"
          autoComplete="off"
          spellCheck={false}
          value={draft.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          placeholder={optionURL(group.primaryOption)}
          className="font-mono"
        />
      )}
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={draft.secret}
        onChange={(e) => onChange({ secret: e.target.value })}
        placeholder="API key"
      />
      <CredentialHelp option={group.primaryOption} />
    </div>
  );
}

function ProvenanceLine({ provenance }: { provenance: ExtensionProvenance }) {
  if (provenance.kind !== 'github') return null;
  const shortSha = provenance.sha.slice(0, 7);
  const path = provenance.subdir
    ? `${provenance.owner}/${provenance.repo}/${provenance.subdir}`
    : `${provenance.owner}/${provenance.repo}`;
  return (
    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
      <button
        type="button"
        className="cursor-pointer underline underline-offset-2 hover:text-foreground"
        onClick={() => openExternalLink(provenance.url)}
      >
        {path}
      </button>{' '}
      @ {shortSha}
    </p>
  );
}

function ExpandableDescription({ children }: { children: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="mt-1 block w-full cursor-pointer text-left text-xs text-muted-foreground hover:text-foreground"
      aria-expanded={expanded}
    >
      <span className={expanded ? 'block' : 'line-clamp-1'}>{children}</span>
    </button>
  );
}

function ModelPicker({
  providerType,
  value,
  onChange,
  onCommit
}: {
  providerType: string;
  value: string;
  onChange: (modelKey: string) => void;
  onCommit?: (modelKey: string) => void;
}) {
  const piProvider = getProviderEntry(providerType)?.piProvider ?? null;
  const modelOptions = useMemo(() => {
    if (!piProvider) return [];
    return getModels(piProvider)
      .map((m) => ({ id: m.id, name: m.name }))
      .reverse();
  }, [piProvider]);

  const isInCatalog = modelOptions.some((m) => m.id === value);
  const [useCustom, setUseCustom] = useState(!isInCatalog && value !== '');

  if (modelOptions.length === 0 || useCustom) {
    return (
      <div className="flex flex-col gap-1.5">
        <FieldLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Model
        </FieldLabel>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit?.(value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommit?.(value);
            }
          }}
          placeholder="model-id"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Model
      </FieldLabel>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === '__custom__') {
            setUseCustom(true);
            onChange('');
            return;
          }
          const next = v ?? '';
          onChange(next);
          onCommit?.(next);
        }}
      >
        <SelectTrigger size="sm">
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          {modelOptions.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
          <SelectItem value="__custom__">
            <span className="flex items-center gap-1.5">
              <IconServer className="size-3.5" />
              Custom Model
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function EditableName({
  value,
  onChange
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium">{value}</span>
        <button
          type="button"
          aria-label="Edit name"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setEditing(true)}
        >
          <IconPencil className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.target.select()}
    />
  );
}

function CredentialHelp({ option }: { option: ExtensionProviderOption }) {
  const help = option.credentialHelp;
  if (!help) return null;
  return (
    <FieldDescription className="text-[11px]" onLinkClick={openExternalLink}>
      {help}
    </FieldDescription>
  );
}
