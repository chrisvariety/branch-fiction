import { invoke } from '@tauri-apps/api/core';
import { compareSemVer, isValidSemVer } from 'semver-parser';
import { v7 as uuidv7 } from 'uuid';

import { DEFAULT_ORG_ID } from '../lib/auth';
import {
  CLOUD_PROVIDER_TYPE,
  fetchCloudCatalog,
  type CloudCatalogResponse,
  type CloudProvider,
  type CloudSlot
} from '../lib/cloud';
import { getDb } from '../lib/db';
import { getExtensionProviderBindings } from '../lib/db/models/extension-provider/get-extension-provider';
import {
  getExtensionById,
  listExtensions
} from '../lib/db/models/extension/get-extension';
import { updateExtensionById } from '../lib/db/models/extension/update-extension';
import { getOrganizationTextModel } from '../lib/db/models/organization-text-model/organization-text-model';
import { getProvidersByOrganizationId } from '../lib/db/models/provider/get-provider';
import type { Extension, Provider } from '../lib/db/types';
import {
  getProviderEntryByOriginAndAuth,
  providerMatchesOriginAndAuth
} from '../lib/llm/providers';
import { primaryTextModel, selectableTextProviders } from '../lib/llm/text-model';
import {
  defaultsFromManifest,
  hasMissingConfigFields,
  isCloudEligible,
  isOptionalRequirement,
  isUseSlotRequirement,
  optionURL,
  provenanceFromRow,
  provenanceToRow,
  requirementHasModel,
  validateManifest,
  type ExtensionProvenance,
  type ExtensionManifestV1,
  type ExtensionProviderOption,
  type ExtensionProviderRequirement,
  type ExtensionProviderRequirementOptions,
  type ExtensionProviderRequirementSlot,
  type ResolvedOption,
  type ResolvedRequirement,
  type SlotCandidate,
  type StagedExtensionInstall
} from './manifest';
import { revokeSession } from './session-tokens';

const ORG_ID = DEFAULT_ORG_ID;

function providerDedupeKey(baseURL: string, auth: unknown): string {
  let origin: string;
  try {
    origin = new URL(baseURL).origin;
  } catch {
    origin = baseURL;
  }
  return `${origin}|${JSON.stringify(auth)}`;
}

async function readManifestFromDisk(sourcePath: string): Promise<ExtensionManifestV1> {
  const raw = await invoke<string>('read_extension_manifest_at', { sourcePath });
  let parsed: ExtensionManifestV1;
  try {
    parsed = JSON.parse(raw) as ExtensionManifestV1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`manifest.json is not valid JSON: ${message}`);
  }
  validateManifest(parsed);
  return parsed;
}

// Virtual provider for cloud-proxied upstreams: Cloud id/name/type with overridden origin+auth for manifest matching.
type MatchableProvider = Provider & { overrideBaseUrl?: string };

type SignatureStatus = 'absent' | 'valid' | 'invalid';

async function checkExtensionSignature(sourcePath: string): Promise<SignatureStatus> {
  try {
    return await invoke<SignatureStatus>('verify_extension_signature_cmd', {
      sourcePath
    });
  } catch {
    return 'absent';
  }
}

type CloudTextSlotInfo = { upstreamName: string; modelName: string };

// The catalog-advertised upstream provider + model behind each text role (piText, piTextLight).
function resolveCloudTextSlots(
  catalog: CloudCatalogResponse
): Record<string, CloudTextSlotInfo> {
  const out: Record<string, CloudTextSlotInfo> = {};
  for (const [role, slot] of Object.entries(catalog.slots)) {
    const provider = catalog.providers.find((p) => p.baseUrl === slot.baseUrl);
    const preset = provider
      ? getProviderEntryByOriginAndAuth(provider.baseUrl, provider.auth)
      : null;
    out[role] = { upstreamName: preset?.name ?? '', modelName: slot.modelKey ?? '' };
  }
  return out;
}

async function buildCloudMatchContext(
  providers: Provider[],
  manifestId: string,
  provenance: ExtensionProvenance | undefined,
  signed: boolean
): Promise<{
  virtuals: MatchableProvider[];
  slots: Record<string, CloudSlot>;
  textSlots: Record<string, CloudTextSlotInfo>;
}> {
  const empty = { virtuals: [], slots: {}, textSlots: {} };
  if (!isCloudEligible(provenance, signed)) return empty;
  const cloudRow = providers.find((p) => p.type === CLOUD_PROVIDER_TYPE);
  if (!cloudRow) return empty;
  try {
    const catalog = await fetchCloudCatalog();
    const virtuals = catalog.providers.map((cp) => ({
      ...cloudRow,
      baseUrl: cp.baseUrl,
      authShape: cp.auth,
      overrideBaseUrl: cp.proxyBaseUrl
    }));
    return {
      virtuals,
      slots: catalog.extensionModels?.[manifestId] ?? {},
      textSlots: resolveCloudTextSlots(catalog)
    };
  } catch {
    return empty;
  }
}

export async function stageExtensionInstall(
  sourcePath: string,
  provenance: ExtensionProvenance
): Promise<StagedExtensionInstall> {
  const manifest = await readManifestFromDisk(sourcePath);
  const existing = await getExtensionById(manifest.id);
  const sigStatus = await checkExtensionSignature(sourcePath);
  if (sigStatus === 'invalid') {
    throw new Error(
      'This extension carries a signature that does not verify — it may have been ' +
        'modified after signing. Refusing to install.'
    );
  }
  const signed = sigStatus === 'valid';
  const reqs = manifest.providers ?? [];
  const providers = reqs.length > 0 ? await getProvidersByOrganizationId(ORG_ID) : [];
  const {
    virtuals: cloudVirtuals,
    slots: extensionSlots,
    textSlots: cloudTextSlots
  } = reqs.length > 0
    ? await buildCloudMatchContext(providers, manifest.id, provenance, signed)
    : { virtuals: [], slots: {}, textSlots: {} };
  const existingBindings = existing
    ? await getExtensionProviderBindings(manifest.id)
    : [];
  const hasUseSlot = reqs.some(isUseSlotRequirement);
  const orgTextModel = hasUseSlot ? await getOrganizationTextModel() : undefined;
  const requirements: ResolvedRequirement[] = [];
  for (const req of reqs) {
    if (isUseSlotRequirement(req)) {
      requirements.push(
        resolveSlotRequirement(
          req,
          providers,
          orgTextModel,
          existingBindings,
          cloudTextSlots
        )
      );
    } else {
      // Cloud is authoritative for provider+model, so only offered where it declares a slot.
      const slot = extensionSlots[req.key];
      const allowedCloud = slot
        ? cloudVirtuals.filter((v) => v.baseUrl === slot.baseUrl)
        : [];
      const matchable: MatchableProvider[] = [...providers, ...allowedCloud];
      requirements.push(resolveOptionsRequirement(req, matchable, existingBindings));
    }
  }
  return {
    sourcePath,
    manifest,
    isReinstall: existing != null,
    requirements,
    provenance,
    signed,
    mode: 'install',
    existingConfig: existing?.config
  };
}

export async function stageExtensionConfigure(
  extensionId: string
): Promise<StagedExtensionInstall> {
  const extension = await getExtensionById(extensionId);
  if (!extension) throw new Error(`Extension not found: ${extensionId}`);
  const staged = await stageExtensionInstall(
    extension.path,
    provenanceFromRow(extension)
  );
  return { ...staged, mode: 'configure' };
}

type FetchedExtensionPayload = {
  path: string;
  provenance: ExtensionProvenance;
};

// Returns null when nothing is published at the URL (HTTP 404); throws on genuine failures.
export async function fetchRemoteManifest(
  url: string
): Promise<ExtensionManifestV1 | null> {
  const res = await invoke<{ found: boolean; manifest: string | null }>(
    'check_github_manifest',
    { url }
  );
  if (!res.found || res.manifest === null) return null;
  let parsed: ExtensionManifestV1;
  try {
    parsed = JSON.parse(res.manifest) as ExtensionManifestV1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`remote manifest.json is not valid JSON: ${message}`);
  }
  validateManifest(parsed);
  return parsed;
}

export async function checkGithubManifest(url: string): Promise<ExtensionManifestV1> {
  const manifest = await fetchRemoteManifest(url);
  if (!manifest) throw new Error(`No manifest.json found at ${url}`);
  return manifest;
}

export async function stageExtensionInstallFromGithub(
  url: string
): Promise<StagedExtensionInstall> {
  // Fail-fast: read + validate the manifest before downloading the zipball.
  await checkGithubManifest(url);
  const fetched = await invoke<FetchedExtensionPayload>('fetch_extension_from_github', {
    url
  });
  try {
    return await stageExtensionInstall(fetched.path, fetched.provenance);
  } catch (err) {
    await cleanupExtensionFetch(fetched.path).catch(() => {});
    throw err;
  }
}

export type ExtensionUpdateResult =
  | { kind: 'up-to-date'; version: string }
  | { kind: 'update'; current: string; latest: string; url: string }
  | { kind: 'error'; message: string };

// GitHub extensions use the install URL; others use manifest `repository`. Null if not updatable.
export function updateSourceUrl(extension: Extension): string | null {
  if (extension.provenanceType === 'github') {
    const url = extension.provenanceConfig.url;
    if (typeof url === 'string' && url) return url;
  }
  const repo = (extension.manifest as ExtensionManifestV1).repository;
  return typeof repo === 'string' && repo ? repo : null;
}

// Remote supersedes local only when strictly newer by SemVer; falls back to string inequality.
function remoteIsNewer(remote: string, local: string): boolean {
  if (isValidSemVer(remote) && isValidSemVer(local)) {
    return compareSemVer(remote, local) > 0;
  }
  return remote !== local;
}

export async function checkExtensionUpdate(
  extension: Extension
): Promise<ExtensionUpdateResult> {
  const url = updateSourceUrl(extension);
  if (!url) return { kind: 'up-to-date', version: extension.version };
  try {
    const manifest = await fetchRemoteManifest(url);
    // Nothing published at the source yet
    if (!manifest) return { kind: 'up-to-date', version: extension.version };
    if (manifest.id !== extension.id) {
      return {
        kind: 'error',
        message: `remote manifest id "${manifest.id}" differs from installed "${extension.id}"`
      };
    }
    if (remoteIsNewer(manifest.version, extension.version)) {
      return {
        kind: 'update',
        current: extension.version,
        latest: manifest.version,
        url
      };
    }
    return { kind: 'up-to-date', version: extension.version };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function cleanupExtensionFetch(stagingPath: string): Promise<void> {
  await invoke('cleanup_extension_fetch', { stagingPath });
}

type OrgProvider = Awaited<ReturnType<typeof getProvidersByOrganizationId>>[number];

type OrgTextModel = Awaited<ReturnType<typeof getOrganizationTextModel>>;

// Resolves a `useSlot` requirement: defaults to the extension's override or the org text model.
function resolveSlotRequirement(
  req: ExtensionProviderRequirementSlot,
  providers: OrgProvider[],
  orgTextModel: OrgTextModel,
  bindings: { providerKey: string; providerId: string }[],
  cloudTextSlots: Record<string, CloudTextSlotInfo>
): ResolvedRequirement {
  const candidates: SlotCandidate[] = selectableTextProviders(providers).flatMap((p) => {
    const model = primaryTextModel(p);
    if (!model) return [];
    const candidate: SlotCandidate = {
      providerModelId: model.id,
      providerId: p.id,
      providerName: p.name,
      providerType: p.type,
      modelKey: model.modelKey
    };
    if (p.type === CLOUD_PROVIDER_TYPE) {
      const info = cloudTextSlots[req.useSlot];
      candidate.cloudUpstreamName = info?.upstreamName || undefined;
      candidate.cloudModelName = info?.modelName || undefined;
    }
    return [candidate];
  });
  if (candidates.length === 0) return { requirement: req, slot: { kind: 'empty' } };

  const boundProviderId = bindings.find((b) => b.providerKey === req.key)?.providerId;
  const defaultModelId =
    req.useSlot === 'piTextLight'
      ? orgTextModel?.textLightProviderModelId
      : orgTextModel?.textProviderModelId;
  const selected =
    (boundProviderId && candidates.find((c) => c.providerId === boundProviderId)) ||
    candidates.find((c) => c.providerModelId === defaultModelId) ||
    candidates[0]!;
  return {
    requirement: req,
    slot: {
      kind: 'configured',
      selectedProviderModelId: selected.providerModelId,
      candidates
    }
  };
}

function resolveOptionsRequirement(
  req: ExtensionProviderRequirementOptions,
  providers: MatchableProvider[],
  bindings: {
    providerKey: string;
    providerId: string;
    modelKey: string | null;
    overrideBaseUrl: string | null;
  }[]
): ResolvedRequirement {
  const options = req.options.map((opt) => resolveOption(opt, providers));
  const bound = bindings.find((b) => b.providerKey === req.key);
  if (!bound) return { requirement: req, options };
  return {
    requirement: req,
    options,
    binding: {
      providerId: bound.providerId,
      modelKey: bound.modelKey ?? null,
      overrideBaseUrl: bound.overrideBaseUrl ?? null
    }
  };
}

// All providers that can satisfy an option, or a single preset/unknown fallback for a new credential.
function resolveOption(
  opt: ExtensionProviderOption,
  providers: MatchableProvider[]
): ResolvedOption[] {
  const url = optionURL(opt);
  const matches = providers.filter((r) => providerMatchesOriginAndAuth(r, url, opt.auth));
  if (matches.length > 0) {
    return matches.map((existing) => ({
      kind: 'existing',
      providerId: existing.id,
      providerName: existing.name,
      providerType: existing.type,
      ...(existing.overrideBaseUrl ? { overrideBaseUrl: existing.overrideBaseUrl } : {})
    }));
  }
  const preset = getProviderEntryByOriginAndAuth(url, opt.auth);
  if (preset) {
    return [{ kind: 'preset', presetType: preset.type, presetName: preset.name }];
  }
  let suggestedName = opt.providerName ?? '';
  if (!suggestedName) {
    try {
      suggestedName = new URL(url).hostname;
    } catch {
      suggestedName = '';
    }
  }
  return [{ kind: 'unknown', suggestedName }];
}

type RequirementInput =
  | {
      kind: 'existing';
      providerKey: string;
      optionIndex: number;
      providerId: string;
      modelKey?: string;
      overrideBaseUrl?: string;
    }
  | {
      kind: 'preset';
      providerKey: string;
      optionIndex: number;
      baseUrl: string;
      name: string;
      secret: string;
      modelKey?: string;
    }
  | {
      kind: 'unknown';
      providerKey: string;
      optionIndex: number;
      baseUrl: string;
      name: string;
      secret: string;
      modelKey?: string;
    };

export type CommitInstallArgs = {
  sourcePath: string;
  expectedId: string;
  requirements: RequirementInput[];
  // User-supplied values for the manifest's `config` fields.
  config?: Record<string, unknown>;
  // Per-extension `useSlot` overrides; persisted as extension_providers bindings.
  slotBindings?: { providerKey: string; providerId: string; modelKey: string }[];
  // 'configure' reuses the existing path without copying files.
  mode?: 'install' | 'configure';
  provenance: ExtensionProvenance;
};

export type ExtensionProviderBinding = {
  extensionId: string;
  providerKey: string;
  providerId: string;
};

export async function commitExtensionInstall(
  args: CommitInstallArgs
): Promise<Extension> {
  const manifest = await readManifestFromDisk(args.sourcePath);
  if (manifest.id !== args.expectedId) {
    throw new Error(
      `Extension id changed between consent and install: expected ${args.expectedId}, got ${manifest.id}`
    );
  }

  const declared = manifest.providers ?? [];
  // `useSlot` areas resolve at session-mint time; only options areas need a persisted binding.
  const optionsReqs = declared.filter((r) => !isUseSlotRequirement(r)) as Extract<
    ExtensionProviderRequirement,
    { options: ExtensionProviderOption[] }
  >[];

  const inputByKey = new Map(args.requirements.map((r) => [r.providerKey, r]));
  // Optional providers left as "None" send no input and are omitted from bindings.
  const boundOptionsReqs = optionsReqs.filter(
    (req) => inputByKey.has(req.key) || !isOptionalRequirement(req)
  );

  const orgProviders = await getProvidersByOrganizationId(ORG_ID);
  const cloudProviderIds = new Set(
    orgProviders.filter((p) => p.type === CLOUD_PROVIDER_TYPE).map((p) => p.id)
  );

  for (const req of boundOptionsReqs) {
    if (!inputByKey.has(req.key)) {
      throw new Error(`Missing input for extension provider "${req.key}"`);
    }
    const input = inputByKey.get(req.key)!;
    const opt = req.options[input.optionIndex];
    if (!opt) {
      throw new Error(
        `Extension provider "${req.key}": optionIndex ${input.optionIndex} is out of range`
      );
    }
    const boundToCloud =
      input.kind === 'existing' && cloudProviderIds.has(input.providerId);
    if (opt.model && !input.modelKey && !boundToCloud) {
      throw new Error(
        `Extension provider "${req.key}" declares a model but no modelKey was selected`
      );
    }
  }

  const resolutions: {
    req: (typeof optionsReqs)[number];
    option: (typeof optionsReqs)[number]['options'][number];
    providerId: string;
  }[] = [];
  const providersToCreate: {
    id: string;
    organizationId: string;
    name: string;
    type: string;
    baseUrl: string;
    authShape: ExtensionProviderOption['auth'];
    secret: string;
  }[] = [];
  // Multiple requirements may share a provider; reuse the planned row to avoid dupes.
  const createdByDedupeKey = new Map<string, string>();
  for (const req of boundOptionsReqs) {
    const input = inputByKey.get(req.key)!;
    const opt = req.options[input.optionIndex];
    let providerId: string;

    if (input.kind === 'existing') {
      providerId = input.providerId;
    } else {
      const baseUrl = input.baseUrl.trim();
      if (!baseUrl) {
        throw new Error(`Extension provider "${req.key}": missing baseUrl`);
      }
      try {
        new URL(baseUrl);
      } catch {
        throw new Error(`Extension provider "${req.key}": invalid baseUrl ${baseUrl}`);
      }
      const dedupeKey = providerDedupeKey(baseUrl, opt.auth);
      const reused = createdByDedupeKey.get(dedupeKey);
      if (reused) {
        providerId = reused;
      } else {
        let providerName: string;
        let providerType: string;
        if (input.kind === 'preset') {
          const preset = getProviderEntryByOriginAndAuth(baseUrl, opt.auth);
          if (!preset) {
            throw new Error(
              `Extension provider "${req.key}" option ${input.optionIndex} was marked preset but no catalog match exists for ${baseUrl}`
            );
          }
          providerName = input.name.trim() || preset.name;
          providerType = preset.type;
        } else {
          let fallbackName = opt.providerName ?? '';
          if (!fallbackName) {
            try {
              fallbackName = new URL(baseUrl).hostname;
            } catch {
              fallbackName = req.key;
            }
          }
          providerName = input.name.trim() || fallbackName;
          providerType = 'custom';
        }

        providerId = uuidv7();
        providersToCreate.push({
          id: providerId,
          organizationId: ORG_ID,
          name: providerName,
          type: providerType,
          baseUrl,
          authShape: opt.auth,
          secret: input.secret
        });
        createdByDedupeKey.set(dedupeKey, providerId);
      }
    }

    resolutions.push({ req, option: opt, providerId });
  }

  const existing = await getExtensionById(manifest.id);
  const mode = args.mode ?? 'install';
  if (mode === 'configure' && !existing) {
    throw new Error(`Cannot configure ${manifest.id}: extension is not installed`);
  }

  const defaults = defaultsFromManifest(manifest);
  const config = {
    ...defaults,
    ...(existing?.config ?? {}),
    ...(args.config ?? {})
  };
  const { provenanceType, provenanceConfig } = provenanceToRow(args.provenance);
  const extensionPlan = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    manifest,
    config,
    enabled: existing ? existing.enabled : !hasMissingConfigFields(manifest, config),
    provenanceType,
    provenanceConfig
  };

  const bindings: {
    providerKey: string;
    providerId: string;
    overrideBaseUrl: string | null;
    modelKey: string | null;
  }[] = [];
  for (const { req, option, providerId } of resolutions) {
    const input = inputByKey.get(req.key)!;
    const overrideBaseUrl =
      input.kind === 'existing' ? (input.overrideBaseUrl ?? null) : null;
    const modelKey = option.model && input.modelKey ? input.modelKey : null;
    bindings.push({ providerKey: req.key, providerId, overrideBaseUrl, modelKey });
  }

  // useSlot overrides: a per-extension text-model binding (no base-url override).
  for (const sb of args.slotBindings ?? []) {
    bindings.push({
      providerKey: sb.providerKey,
      providerId: sb.providerId,
      overrideBaseUrl: null,
      modelKey: sb.modelKey
    });
  }

  await invoke('commit_extension_install', {
    plan: {
      extensionId: manifest.id,
      sourcePath: args.sourcePath,
      copyFiles: mode !== 'configure',
      existingPath: existing?.path ?? null,
      providersToCreate,
      extension: extensionPlan,
      isUpdate: existing != null,
      bindings
    }
  });

  const row = await getExtensionById(manifest.id);
  if (!row) throw new Error(`Extension row missing after install: ${manifest.id}`);
  return row as Extension;
}

export async function listInstalledExtensions(): Promise<Extension[]> {
  return listExtensions();
}

export async function listExtensionBindings(): Promise<ExtensionProviderBinding[]> {
  return getDb()
    .selectFrom('extensionProviders')
    .select(['extensionId', 'providerKey', 'providerId'])
    .execute();
}

export async function setExtensionEnabled(
  id: string,
  enabled: boolean
): Promise<Extension> {
  const updated = await updateExtensionById(id, { enabled });
  if (!updated) throw new Error(`Extension not found: ${id}`);
  if (!enabled) await revokeSession(id);
  return updated as Extension;
}

export async function updateExtensionConfig(
  id: string,
  config: Record<string, unknown>
): Promise<Extension> {
  const updated = await updateExtensionById(id, { config });
  if (!updated) throw new Error(`Extension not found: ${id}`);
  return updated as Extension;
}

export async function setExtensionProviderModel(args: {
  extensionId: string;
  providerKey: string;
  modelKey: string;
}): Promise<void> {
  const extension = await getExtensionById(args.extensionId);
  if (!extension) throw new Error(`Extension not found: ${args.extensionId}`);

  const manifest = extension.manifest as ExtensionManifestV1;
  const req = (manifest.providers ?? []).find((r) => r.key === args.providerKey);
  if (!req) {
    throw new Error(
      `Extension provider "${args.providerKey}" not found on extension "${args.extensionId}"`
    );
  }
  if (isUseSlotRequirement(req)) {
    throw new Error(
      `Extension provider "${args.providerKey}" uses your text model — change it from the import step or Settings → Providers.`
    );
  }
  if (!requirementHasModel(req)) {
    throw new Error(
      `Extension provider "${args.providerKey}" does not declare a model — nothing to configure`
    );
  }

  const modelKey = args.modelKey.trim();
  if (!modelKey) throw new Error('modelKey is required');

  await invoke('set_extension_provider_model', {
    extensionId: args.extensionId,
    providerKey: args.providerKey,
    modelKey
  });
}

export async function uninstallExtension(id: string): Promise<void> {
  await revokeSession(id);
  await invoke('uninstall_extension', { extensionId: id });
}

type CloudBinding = {
  extensionId: string;
  providerKey: string;
  providerId: string;
  overrideBaseUrl: string | null;
  modelKey: string | null;
};

// Fill in unbound provider keys on cloud-eligible extensions
export async function autoConfigureCloudEligibleExtensions(): Promise<void> {
  const baseProviders = await getProvidersByOrganizationId(ORG_ID);
  const cloudRow = baseProviders.find((p) => p.type === CLOUD_PROVIDER_TYPE);
  if (!cloudRow) return;

  let cloudProviders: CloudProvider[];
  let extensionModels: Record<string, Record<string, CloudSlot>>;
  try {
    const catalog = await fetchCloudCatalog();
    cloudProviders = catalog.providers;
    extensionModels = catalog.extensionModels ?? {};
  } catch (err) {
    console.warn('auto-configure: failed to fetch cloud catalog', err);
    return;
  }
  if (cloudProviders.length === 0) return;

  const extensions = await listExtensions();
  const bindings: CloudBinding[] = [];
  for (const extension of extensions) {
    if (!isCloudEligible(provenanceFromRow(extension), extension.signed)) continue;
    await planCloudAutoConfigure(
      extension,
      cloudRow.id,
      cloudProviders,
      extensionModels,
      bindings
    );
  }
  if (bindings.length === 0) return;

  await invoke('auto_configure_cloud_extensions', { bindings });
}

async function planCloudAutoConfigure(
  extension: Extension,
  cloudProviderId: string,
  cloudProviders: CloudProvider[],
  extensionModels: Record<string, Record<string, CloudSlot>>,
  bindings: CloudBinding[]
): Promise<void> {
  const slots = extensionModels[extension.id];
  if (!slots) return;

  const manifest = extension.manifest as ExtensionManifestV1;
  const optionKeys = new Set(
    (manifest.providers ?? [])
      .filter((r): r is ExtensionProviderRequirementOptions => !isUseSlotRequirement(r))
      .map((r) => r.key)
  );

  const existing = await getExtensionProviderBindings(extension.id);
  const bound = new Set(existing.map((b) => b.providerKey));

  // the cloud catalog is authoritative for provider+model
  for (const [providerKey, slot] of Object.entries(slots)) {
    if (bound.has(providerKey) || !optionKeys.has(providerKey)) continue;
    const cloud = cloudProviders.find((cp) => cp.baseUrl === slot.baseUrl);
    if (!cloud) continue;
    bindings.push({
      extensionId: extension.id,
      providerKey,
      providerId: cloudProviderId,
      overrideBaseUrl: cloud.proxyBaseUrl,
      modelKey: null
    });
  }
}
