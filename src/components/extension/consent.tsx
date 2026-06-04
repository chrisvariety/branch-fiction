import { getModels } from '@earendil-works/pi-ai';
import { IconChevronLeft, IconPencil, IconServer } from '@tabler/icons-react';
import { message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Fragment, useMemo, useRef, useState } from 'react';

import { getProviderIcon } from '@/components/icons/provider-icons';
import { providerFormProps } from '@/components/provider/form-props';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { CommitInstallArgs } from '@/extensions/install';
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
import { useCommitExtensionInstall } from '@/hooks/queries/extensions';
import { CLOUD_PROVIDER_TYPE } from '@/lib/cloud';
import {
  getProviderCatalog,
  getProviderEntry,
  getProviderEntryByOriginAndAuth,
  providerMatchesOriginAndAuth,
  SLOT_LABELS
} from '@/lib/llm/providers';

const openExternalLink = (url: string) => void openUrl(url);

type CredentialDraft = { name: string; secret: string; baseUrl: string };

type RequirementState = {
  optionIndex: number;
  // Selected candidate per option when several providers match the same upstream.
  candidateIndexes: Record<number, number>;
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
  options: ResolvedOption[][];
  binding?: {
    providerId: string;
    modelKey: string | null;
    overrideBaseUrl: string | null;
  };
}): RequirementState {
  const modelKeys: Record<number, string> = {};
  r.options.forEach((_cands, i) => {
    modelKeys[i] = r.requirement.options[i]!.model ?? '';
  });
  if (r.binding) {
    const b = r.binding;
    for (let i = 0; i < r.options.length; i++) {
      const j = r.options[i]!.findIndex(
        (c) =>
          c.kind === 'existing' &&
          c.providerId === b.providerId &&
          (c.overrideBaseUrl ?? null) === (b.overrideBaseUrl ?? null)
      );
      if (j < 0) continue;
      if (b.modelKey) modelKeys[i] = b.modelKey;
      return {
        optionIndex: i,
        candidateIndexes: { [i]: j },
        modelKeys,
        useNewCredential: {}
      };
    }
  }
  // Optional providers default to "None" (no option selected) until the user picks one.
  if (isOptionalRequirement(r.requirement)) {
    return { optionIndex: -1, candidateIndexes: {}, modelKeys, useNewCredential: {} };
  }
  const existingIdx = r.options.findIndex((cands) =>
    cands.some((c) => c.kind === 'existing')
  );
  const optionIndex = existingIdx >= 0 ? existingIdx : 0;
  return { optionIndex, candidateIndexes: {}, modelKeys, useNewCredential: {} };
}

function initialCredentialDrafts(
  optionsReqs: OptionsRequirement[]
): Record<string, CredentialDraft> {
  const seed: Record<string, CredentialDraft> = {};
  for (const r of optionsReqs) {
    r.options.forEach((cands, i) => {
      const resolved = cands[0]!;
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

type OptionsRequirement = Extract<ResolvedRequirement, { options: ResolvedOption[][] }>;
type SlotRequirement = Extract<ResolvedRequirement, { slot: ResolvedSlot }>;

function isOptionsResolved(r: ResolvedRequirement): r is OptionsRequirement {
  return 'options' in r;
}

type SlotBinding = { providerKey: string; providerId: string; modelKey: string };

// Inline credential for `useSlot` areas when no text provider exists yet.
type NewTextProviderDraft = { providerType: string; apiKey: string; modelKey: string };

function defaultTextProviderDraft(): NewTextProviderDraft {
  const first = getProviderCatalog().find(
    (p) => !p.isCompatibleVariant && !p.requiresBaseUrl
  )!;
  return { providerType: first.type, apiKey: '', modelKey: '' };
}

function textProviderDraftReady(draft: NewTextProviderDraft): boolean {
  const entry = getProviderEntry(draft.providerType);
  if (!entry) return false;
  if (draft.modelKey.trim().length === 0) return false;
  return entry.authShape.kind === 'none' || draft.apiKey.length > 0;
}

type CreatedTextProvider = {
  providerId: string;
  providerType: string;
  apiKey: string | null;
  slotBindings: SlotBinding[];
};

// Test, create, and return slot bindings for a brand-new text provider.
async function createTextProviderForSlots(
  reqs: SlotRequirement[],
  draft: NewTextProviderDraft
): Promise<CreatedTextProvider> {
  const entry = getProviderEntry(draft.providerType);
  if (!entry) throw new Error(`Unknown provider type: ${draft.providerType}`);
  const modelKey = draft.modelKey.trim();
  const apiKey = entry.authShape.kind === 'none' ? null : draft.apiKey;

  const test = await providerFormProps.testProviderConfig({
    providerType: entry.type,
    apiKey,
    apiKeyEnvVar: null,
    baseUrl: null,
    modelId: modelKey
  });
  if (!test.ok) throw new Error(`${entry.name}: ${test.error}`);

  const displayName = entry.piProvider
    ? (getModels(entry.piProvider).find((m) => m.id === modelKey)?.name ?? null)
    : null;
  const { providerId } = await providerFormProps.createProviderWithModel({
    provider: {
      name: entry.name,
      type: entry.type,
      authShape: entry.authShape,
      secretEnvVar: null,
      secretPriority: 'key',
      baseUrl: null,
      secret: apiKey,
      rpmLimit: null
    },
    model: { modelKey, displayName, config: null, reasoning: null }
  });

  return {
    providerId,
    providerType: entry.type,
    apiKey,
    slotBindings: reqs.map((r) => ({
      providerKey: r.requirement.key,
      providerId,
      modelKey
    }))
  };
}

// A credential entry duplicates the new text provider when it targets the same upstream with the same key.
function credentialMatchesCreatedProvider(
  option: ExtensionProviderOption,
  cred: CredentialDraft,
  created: CreatedTextProvider
): boolean {
  const entry = getProviderEntry(created.providerType);
  if (!entry) return false;
  if (created.apiKey === null || cred.secret !== created.apiKey) return false;
  const baseUrl = cred.baseUrl.trim() || optionURL(option);
  return providerMatchesOriginAndAuth(
    { baseUrl: null, type: created.providerType, authShape: entry.authShape },
    baseUrl,
    option.auth
  );
}

export function ConsentScreen({
  staged,
  onClose,
  onSuccess,
  variant = 'consent'
}: {
  staged: StagedExtensionInstall;
  onClose: () => void;
  onSuccess?: () => void;
  // 'setup' centers the heading and moves submit to the bottom (book-page flow).
  variant?: 'consent' | 'setup';
}) {
  const commit = useCommitExtensionInstall();

  const { manifest } = staged;

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isCreatingProvider, setIsCreatingProvider] = useState(false);
  const isPending = commit.isPending || isCreatingProvider;

  const optionsReqs = staged.requirements.filter(isOptionsResolved);
  const slotReqs = staged.requirements.filter(
    (r): r is SlotRequirement => !isOptionsResolved(r)
  );
  const configuredSlotReqs = slotReqs.filter((r) => r.slot.kind === 'configured');
  const emptySlotReqs = slotReqs.filter((r) => r.slot.kind === 'empty');

  const [textProviderDraft, setTextProviderDraft] = useState(defaultTextProviderDraft);
  // Reused across retries so a failed commit doesn't create duplicate providers.
  const createdTextProviderRef = useRef<CreatedTextProvider | null>(null);

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
    const candidates = r.options[optionIndex]!;
    const base = candidates[state.candidateIndexes[optionIndex] ?? 0]!;
    const resolved = effectiveResolvedOption(
      option,
      base,
      state.useNewCredential[optionIndex] ?? false
    );
    return { r, optionIndex, resolved, option };
  });

  const bindingReqs = activeOptionsReqs.filter(
    (r) =>
      !requirementHasModel(r.requirement) &&
      r.requirement.options.length === 1 &&
      r.options[0]!.some((c) => c.kind === 'existing')
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
    (emptySlotReqs.length === 0 || textProviderDraftReady(textProviderDraft)) &&
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

  function setCandidateIndex(
    reqKey: string,
    optionIndex: number,
    candidateIndex: number
  ) {
    setReqStates((prev) => {
      const state = prev[reqKey]!;
      return {
        ...prev,
        [reqKey]: {
          ...state,
          candidateIndexes: { ...state.candidateIndexes, [optionIndex]: candidateIndex }
        }
      };
    });
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

  async function handleSubmit() {
    setSubmitError(null);
    try {
      if (emptySlotReqs.length > 0 && !createdTextProviderRef.current) {
        setIsCreatingProvider(true);
        try {
          createdTextProviderRef.current = await createTextProviderForSlots(
            emptySlotReqs,
            textProviderDraft
          );
        } finally {
          setIsCreatingProvider(false);
        }
      }
      const createdTextProvider = createdTextProviderRef.current;

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
        // Same upstream + key as the new text provider: bind to it instead of creating a duplicate.
        if (
          createdTextProvider &&
          credentialMatchesCreatedProvider(p.option, cred, createdTextProvider)
        ) {
          return {
            kind: 'existing',
            providerKey: p.r.requirement.key,
            optionIndex: p.optionIndex,
            providerId: createdTextProvider.providerId,
            modelKey
          };
        }
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
      const slotBindings: SlotBinding[] = slotReqs.flatMap((r) => {
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
      if (createdTextProvider) {
        slotBindings.push(...createdTextProvider.slotBindings);
      }
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
          onSuccess: () => {
            onSuccess?.();
            onClose();
          },
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
      {variant === 'setup' ? (
        <div className="flex flex-col items-center gap-3 pt-4 pb-6 text-center">
          <h2 className="font-serif text-xl tracking-tight text-balance">
            {headingVerb} {manifest.name}
          </h2>
          <div className="h-px w-8 bg-border" />
        </div>
      ) : (
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
              <Button
                size="sm"
                onClick={() => void handleSubmit()}
                disabled={isPending || !canInstall}
              >
                {isPending ? 'Saving…' : 'Done'}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

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
            slotReqs={configuredSlotReqs}
            reqStates={reqStates}
            slotSelections={slotSelections}
            showAdvanced={showAdvanced}
            onToggleAdvanced={() => setShowAdvanced((v) => !v)}
            onSetOptionIndex={setOptionIndex}
            onSetCandidateIndex={setCandidateIndex}
            onSetModelKey={setModelKey}
            onSetSlotProvider={setSlotProvider}
            onSetUseNewCredential={setUseNewCredential}
          />
        )}

        {bindingReqs.length > 0 && (
          <ProviderBindingBox
            reqs={bindingReqs}
            reqStates={reqStates}
            onChangeCandidateIndex={setCandidateIndex}
            onChangeCredentialSource={setUseNewCredential}
          />
        )}

        {emptySlotReqs.length > 0 && (
          <NewTextProviderBox
            label={SLOT_LABELS[emptySlotReqs[0]!.requirement.useSlot]}
            roles={emptySlotReqs.map((r) => r.requirement.role ?? r.requirement.key)}
            draft={textProviderDraft}
            onChange={(patch) => {
              createdTextProviderRef.current = null;
              setTextProviderDraft((prev) => ({ ...prev, ...patch }));
            }}
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
        {variant === 'setup' ? (
          <div className="flex flex-col gap-4 pt-2">
            <Button
              className="w-full"
              onClick={() => void handleSubmit()}
              disabled={!canInstall}
            >
              {isPending ? 'Saving...' : 'Save & Continue'}
            </Button>
            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50"
              onClick={onClose}
              disabled={isPending}
            >
              Back
            </button>
          </div>
        ) : (
          !isConfigure && (
            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                onClick={() => void handleSubmit()}
                disabled={!canInstall}
              >
                {isPending ? 'Installing…' : installLabel}
              </Button>
            </div>
          )
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
  onSetCandidateIndex,
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
  onSetCandidateIndex: (
    reqKey: string,
    optionIndex: number,
    candidateIndex: number
  ) => void;
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
    const state = reqStates[r.requirement.key]!;
    const idx = state.optionIndex;
    if (idx < 0) return true;
    const candidates = r.options[idx]!;
    if (candidates.length > 1) return true;
    const selected = candidates[state.candidateIndexes[idx] ?? 0]!;
    return requirementHasModel(r.requirement) && !isCloudBound(selected);
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
          onChangeCandidate={(i, j) => onSetCandidateIndex(r.requirement.key, i, j)}
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
        <SelectTrigger size="sm" className="w-full">
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
  onChangeCandidate,
  onChangeModel,
  onChangeCredentialSource
}: {
  req: OptionsRequirement;
  state: RequirementState;
  showAdvanced: boolean;
  onChangeOption: (nextIndex: number) => void;
  onChangeCandidate: (optionIndex: number, candidateIndex: number) => void;
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
  const candidateIndex = isNone ? 0 : (state.candidateIndexes[optionIndex] ?? 0);
  const option = isNone ? null : req.requirement.options[optionIndex]!;
  const resolved = option
    ? effectiveResolvedOption(option, req.options[optionIndex]![candidateIndex]!, useNew)
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
      const cands = req.options[i]!;
      const entries = cands.map((c, j) => ({
        value: `opt:${i}:${j}`,
        label: providerLabelFor(opt, c)
      }));
      // Cloud-only upstreams also offer entering your own credential.
      const hasOwnCredential = cands.some(
        (c) => c.kind === 'existing' && c.providerType !== CLOUD_PROVIDER_TYPE
      );
      const hasCloud = cands.some(
        (c) => c.kind === 'existing' && c.providerType === CLOUD_PROVIDER_TYPE
      );
      if (hasCloud && !hasOwnCredential) {
        entries.push({ value: `new:${i}`, label: optionUpstreamLabel(opt) });
      }
      return entries;
    })
  ];

  const selectValue = isNone
    ? 'none'
    : useNew
      ? `new:${optionIndex}`
      : `opt:${optionIndex}:${candidateIndex}`;
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
              const [prefix, iStr, jStr] = v.split(':');
              const i = Number(iStr);
              onChangeOption(i);
              onChangeCredentialSource(i, prefix === 'new');
              if (prefix === 'opt') onChangeCandidate(i, Number(jStr));
            }}
          >
            <SelectTrigger size="sm" className="w-full">
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
  onChangeCandidateIndex,
  onChangeCredentialSource
}: {
  reqs: OptionsRequirement[];
  reqStates: Record<string, RequirementState>;
  onChangeCandidateIndex: (
    reqKey: string,
    optionIndex: number,
    candidateIndex: number
  ) => void;
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
  const newLabel = 'Use a new credential…';
  return (
    <div className="flex flex-col gap-2 border border-border p-3">
      <p className="mb-2">{heading}</p>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
        {reqs.map((r) => {
          const role = r.requirement.role ?? r.requirement.key;
          const state = reqStates[r.requirement.key]!;
          const optionIndex = state.optionIndex;
          const option = r.requirement.options[optionIndex]!;
          const candidates = r.options[optionIndex]!;
          const candidateIndex = state.candidateIndexes[optionIndex] ?? 0;
          const useNew = state.useNewCredential[optionIndex] ?? false;
          const labelFor = (v: string) =>
            v === '__new__'
              ? newLabel
              : providerLabelFor(option, candidates[Number(v.slice(5))]!);
          return (
            <Fragment key={r.requirement.key}>
              <span className="text-muted-foreground">{role}</span>
              <Select
                value={useNew ? '__new__' : `cand:${candidateIndex}`}
                onValueChange={(v) => {
                  if (!v) return;
                  if (v === '__new__') {
                    onChangeCredentialSource(
                      r.requirement.key,
                      optionIndex,
                      option,
                      true
                    );
                    return;
                  }
                  onChangeCredentialSource(r.requirement.key, optionIndex, option, false);
                  onChangeCandidateIndex(
                    r.requirement.key,
                    optionIndex,
                    Number(v.slice(5))
                  );
                }}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue>{(value) => labelFor(value as string)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c, j) => (
                    <SelectItem key={`cand:${j}`} value={`cand:${j}`}>
                      {providerLabelFor(option, c)}
                    </SelectItem>
                  ))}
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

function NewTextProviderBox({
  label,
  roles,
  draft,
  onChange
}: {
  label: string;
  roles: string[];
  draft: NewTextProviderDraft;
  onChange: (patch: Partial<NewTextProviderDraft>) => void;
}) {
  const standardProviders = useMemo(
    () =>
      getProviderCatalog().filter((p) => !p.isCompatibleVariant && !p.requiresBaseUrl),
    []
  );
  const entry = getProviderEntry(draft.providerType);
  const requiresAuth = !entry || entry.authShape.kind !== 'none';
  const Icon = getProviderIcon(draft.providerType);

  return (
    <div className="flex flex-col gap-2 border border-border p-3">
      <h4 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </h4>
      <p className="text-[11px] text-muted-foreground">Used by: {roles.join(', ')}.</p>
      <Select
        value={draft.providerType}
        onValueChange={(v) => v && onChange({ providerType: v, modelKey: '' })}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue>
            <span className="flex items-center gap-1.5">
              <Icon className="size-3.5" />
              {entry?.name ?? draft.providerType}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {standardProviders.map((p) => {
            const OptIcon = getProviderIcon(p.type);
            return (
              <SelectItem key={p.type} value={p.type}>
                <span className="flex items-center gap-1.5">
                  <OptIcon className="size-3.5" />
                  {p.name}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {requiresAuth && (
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft.apiKey}
          onChange={(e) => onChange({ apiKey: e.target.value })}
          placeholder={entry?.apiKeyPlaceholder || 'API key'}
        />
      )}
      <ModelPicker
        key={draft.providerType}
        providerType={draft.providerType}
        value={draft.modelKey}
        onChange={(modelKey) => onChange({ modelKey })}
      />
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
