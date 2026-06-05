import { getCatalogModels } from '@branch-fiction/extension-sdk/models-catalog';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import {
  IconAlertTriangle,
  IconChevronRight,
  IconHelp,
  IconRefresh,
  IconServer,
  IconVariable,
  IconKey
} from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';

import { getProviderIcon } from '@/components/icons/provider-icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from '@/components/ui/combobox';
import { Field, FieldLabel } from '@/components/ui/field';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useModelsCatalog } from '@/hooks/queries/models-catalog';
import type { ProviderPreview } from '@/hooks/queries/settings';
import type {
  NewProvider,
  NewProviderModel,
  ProviderAuthShape,
  ProviderUpdate,
  ReasoningLevel
} from '@/lib/db/types';
import {
  getProviderCatalog,
  getProviderEntry,
  type ProviderTypeKey,
  type TestProviderResult
} from '@/lib/llm/providers';

const MIN_CONTEXT_WINDOW = 200000;
const MODEL_COMPARISON_URL =
  'https://artificialanalysis.ai/models?pricing=intelligence-vs-price#pricing-tabs';

const REASONING_LABELS: Record<ReasoningLevel, string> = {
  off: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High'
};
const ALL_REASONING_LEVELS: ReasoningLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
];

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return `${tokens}`;
}

function normalizeBaseUrl(
  url: string | null,
  authShape: ProviderAuthShape
): string | null {
  if (!url) return url;
  const trimmed = url.trim().replace(/\/+$/, '');
  const isAnthropicStyle =
    authShape.kind === 'header' && authShape.header === 'x-api-key';
  return isAnthropicStyle ? trimmed.replace(/\/v1$/, '') : trimmed;
}

type ProviderChoice = ProviderTypeKey | 'compatibleSDK' | 'custom';

export type ListProviders = (params: Record<string, never>) => Promise<ProviderPreview[]>;
export type TestProviderConfig = (params: {
  providerType: string;
  apiKey: string | null;
  apiKeyEnvVar: string | null;
  baseUrl: string | null;
  modelId: string;
}) => Promise<TestProviderResult>;
export type UpsertProvider = (
  params: NewProvider | (ProviderUpdate & { id?: string })
) => Promise<{ id: string } | undefined>;
export type UpsertProviderModel = (params: {
  providerId: string;
  data: Omit<NewProviderModel, 'providerId'>;
}) => Promise<unknown>;
export type RemoveProviderModel = (params: { id: string }) => Promise<{ ok: true }>;
export type CreateProviderWithModel = (params: {
  provider: Omit<NewProvider, 'id' | 'organizationId'>;
  model: Omit<NewProviderModel, 'id' | 'providerId'>;
}) => Promise<{ providerId: string }>;

export function AdvancedProviderForm({
  onBack,
  onProvider,
  onOpenExternal,
  provider: editProvider,
  testProviderConfig,
  upsertProvider,
  upsertProviderModel,
  removeProviderModel,
  createProviderWithModel
}: {
  onBack: () => void;
  onProvider: () => void;
  onOpenExternal: (url: string) => void;
  provider?: ProviderPreview;
  listProviders: ListProviders;
  testProviderConfig: TestProviderConfig;
  upsertProvider: UpsertProvider;
  upsertProviderModel: UpsertProviderModel;
  removeProviderModel: RemoveProviderModel;
  createProviderWithModel: CreateProviderWithModel;
}) {
  const isEditing = !!editProvider;

  const catalog = getProviderCatalog();
  const standardProviders = useMemo(
    () => catalog.filter((p) => !p.isCompatibleVariant),
    [catalog]
  );
  const compatibleVariants = useMemo(
    () => catalog.filter((p) => p.isCompatibleVariant),
    [catalog]
  );
  const defaultProvider = standardProviders[0].type;

  const editEntry = editProvider ? getProviderEntry(editProvider.type) : null;
  const initialChoice: ProviderChoice = !editProvider
    ? defaultProvider
    : editProvider.type === 'custom'
      ? 'custom'
      : editEntry?.isCompatibleVariant
        ? 'compatibleSDK'
        : (editProvider.type as ProviderTypeKey);
  const initialCustomFormat: ProviderTypeKey = editEntry?.isCompatibleVariant
    ? (editProvider!.type as ProviderTypeKey)
    : 'openai_compatible';

  const [choice, setChoice] = useState<ProviderChoice>(initialChoice);
  const [mode, setMode] = useState<'key' | 'env'>(editProvider?.secretPriority ?? 'key');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyEnvVar, setApiKeyEnvVar] = useState(editProvider?.secretEnvVar ?? '');
  const initialModelKey = editProvider?.models[0]?.modelKey ?? '';
  const [modelId, setModelId] = useState<string>(initialModelKey);
  const [baseUrl, setBaseUrl] = useState(editProvider?.baseUrl ?? '');
  const [showBaseUrl, setShowBaseUrl] = useState(
    !!editProvider?.baseUrl && !editEntry?.isCompatibleVariant
  );
  const [customName, setCustomName] = useState(
    editProvider && (initialChoice === 'compatibleSDK' || initialChoice === 'custom')
      ? editProvider.name
      : ''
  );
  const [customFormat, setCustomFormat] = useState<ProviderTypeKey>(initialCustomFormat);
  const [editingKey, setEditingKey] = useState(false);
  const [providerChanged, setProviderChanged] = useState(false);
  const [reasoning, setReasoning] = useState<ReasoningLevel | 'default'>(
    editProvider?.models[0]?.reasoning ?? 'default'
  );
  const [rpmLimitEnabled, setRpmLimitEnabled] = useState(
    !!editProvider?.rpmLimit && editProvider.rpmLimit > 0
  );
  const [rpmLimit, setRpmLimit] = useState(
    editProvider?.rpmLimit ? String(editProvider.rpmLimit) : ''
  );
  const parsedRpmLimit = (() => {
    if (!rpmLimitEnabled) return null;
    const n = parseInt(rpmLimit, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const provider = useMemo(() => {
    if (choice === 'custom') {
      return {
        type: 'custom' as const,
        name: customName.trim() || editProvider!.name,
        label: customName.trim() || editProvider!.name,
        icon: getProviderIcon('custom'),
        keyPlaceholder: '',
        envPlaceholder: '',
        authShape: editProvider!.authShape
      };
    }
    if (choice !== 'compatibleSDK') {
      const entry = getProviderEntry(choice as ProviderTypeKey)!;
      return {
        type: entry.type,
        name: entry.name,
        label: entry.name,
        icon: getProviderIcon(entry.type),
        keyPlaceholder: entry.apiKeyPlaceholder,
        envPlaceholder: entry.envVarPlaceholder,
        authShape: entry.authShape
      };
    }
    const fmt = getProviderEntry(customFormat)!;
    return {
      type: fmt.type,
      name: customName.trim(),
      label: customName.trim() || 'Custom Provider',
      icon: getProviderIcon(fmt.type),
      keyPlaceholder: fmt.apiKeyPlaceholder,
      envPlaceholder: fmt.envVarPlaceholder,
      authShape: fmt.authShape
    };
  }, [choice, customFormat, customName]);

  const baseUrlRequired = choice === 'compatibleSDK' || choice === 'custom';
  const lockedBaseUrlEntry =
    choice === 'openai' || choice === 'anthropic' ? getProviderEntry(choice) : null;
  const requiresAuth = provider.authShape.kind !== 'none';
  const piProvider =
    choice === 'compatibleSDK' || choice === 'custom'
      ? null
      : (getProviderEntry(provider.type)?.piProvider ?? null);

  const modelsCatalog = useModelsCatalog();

  const modelOptions = useMemo(() => {
    if (!piProvider) return [];
    return getCatalogModels(piProvider).reverse();
  }, [piProvider, modelsCatalog.version]);

  const modelItems = useMemo(
    () => modelOptions.map((m) => ({ value: m.id, label: m.name })),
    [modelOptions]
  );

  const selectedModel = useMemo(
    () => modelOptions.find((m) => m.id === modelId),
    [modelOptions, modelId]
  );

  const contextWarning =
    selectedModel != null && selectedModel.contextWindow < MIN_CONTEXT_WINDOW
      ? selectedModel.contextWindow
      : null;
  const supportedReasoningLevels = useMemo<ReasoningLevel[]>(() => {
    if (!selectedModel) return ALL_REASONING_LEVELS;
    return getSupportedThinkingLevels(selectedModel).filter(
      (l): l is ReasoningLevel => l !== 'off'
    );
  }, [selectedModel]);
  const showReasoning = supportedReasoningLevels.length > 0;

  useEffect(() => {
    if (
      reasoning !== 'default' &&
      !supportedReasoningLevels.includes(reasoning as ReasoningLevel)
    ) {
      setReasoning('default');
    }
  }, [reasoning, supportedReasoningLevels]);

  const credentialReady =
    !requiresAuth ||
    (mode === 'key' ? (isEditing && !providerChanged) || !!apiKey : !!apiKeyEnvVar);
  const baseUrlReady = !baseUrlRequired || !!baseUrl;
  const customNameReady =
    (choice !== 'compatibleSDK' && choice !== 'custom') || !!customName.trim();
  const rawBaseUrl = baseUrlRequired || showBaseUrl ? baseUrl || null : null;
  const effectiveBaseUrl = normalizeBaseUrl(rawBaseUrl, provider.authShape);

  const hasNewKey = mode === 'key' && !!apiKey;
  const envVarChanged =
    mode === 'env' && apiKeyEnvVar !== (editProvider?.secretEnvVar ?? '');
  const credentialChanged = hasNewKey || envVarChanged;
  const shouldTest = !isEditing || credentialChanged;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (choice !== 'custom' && !modelId) throw new Error('Pick a model');
      if (baseUrlRequired && !baseUrl) {
        throw new Error('Base URL is required');
      }
      if (choice === 'compatibleSDK' && !customName.trim()) {
        throw new Error('Provider name is required');
      }

      if (shouldTest && choice !== 'custom') {
        const testResult = await testProviderConfig({
          providerType: provider.type,
          apiKey: requiresAuth && mode === 'key' ? apiKey : null,
          apiKeyEnvVar: requiresAuth && mode === 'env' ? apiKeyEnvVar : null,
          baseUrl: effectiveBaseUrl,
          modelId
        });
        if (!testResult.ok) {
          throw new Error(`${provider.label}: ${testResult.error}`);
        }
      }

      if (!isEditing) {
        await createProviderWithModel({
          provider: {
            name: provider.name,
            type: provider.type,
            authShape: provider.authShape,
            secretEnvVar: requiresAuth && mode === 'env' ? apiKeyEnvVar : null,
            secretPriority: requiresAuth ? mode : 'key',
            baseUrl: effectiveBaseUrl,
            secret: requiresAuth && mode === 'key' ? apiKey : null,
            rpmLimit: parsedRpmLimit
          },
          model: {
            modelKey: modelId,
            displayName: selectedModel?.name ?? null,
            config: null,
            reasoning: reasoning === 'default' ? null : reasoning
          }
        });
        return;
      }

      const putJson = await upsertProvider({
        name: provider.name,
        type: provider.type,
        authShape: provider.authShape,
        secretEnvVar: requiresAuth && mode === 'env' ? apiKeyEnvVar : null,
        secretPriority: requiresAuth ? mode : undefined,
        baseUrl: effectiveBaseUrl,
        id: editProvider!.id,
        secret: hasNewKey ? apiKey : undefined,
        rpmLimit: parsedRpmLimit
      });
      if (!putJson) throw new Error('Failed to save provider');
      const providerId = editProvider!.id;

      if (choice !== 'custom') {
        const existingModel = editProvider?.models[0];
        if (existingModel && existingModel.modelKey !== modelId) {
          await removeProviderModel({ id: existingModel.id });
        }

        await upsertProviderModel({
          providerId,
          data: {
            id: uuidv7(),
            modelKey: modelId,
            displayName: selectedModel?.name ?? null,
            config: null,
            reasoning: reasoning === 'default' ? null : reasoning
          }
        });
      }
    },
    onSuccess: () => {
      onProvider();
    }
  });

  const Icon = provider.icon;

  return (
    <div className="flex flex-1 flex-col items-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 className="font-serif text-xl tracking-tight text-balance">
            {isEditing ? `Edit ${editProvider!.name}` : 'Bring your own key'}
          </h2>
          <div className="h-px w-8 bg-border" />
          {isEditing && (
            <p className="text-xs text-muted-foreground">
              Update credentials or connection details for this provider.
            </p>
          )}
        </div>

        {!isEditing && (
          <div>
            <h4 className="mb-2 text-sm font-medium">Tips for success</h4>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li className="leading-relaxed">
                Pick a model with at least a 200k context window that supports tool
                calling and reasoning.
              </li>
              <li className="leading-relaxed">
                We re-read the text many times. A typical book uses about{' '}
                <strong className="text-foreground">15-25M input tokens</strong> to
                import, about half of which are cached reads.
              </li>
              <li className="leading-relaxed">
                Not sure what to choose?{' '}
                <button
                  type="button"
                  className="underline hover:no-underline"
                  onClick={() => onOpenExternal(MODEL_COMPARISON_URL)}
                >
                  Compare models
                </button>{' '}
                on price vs. intelligence &mdash; you're looking for high intelligence
                with a low price. Speed would be great, too.
              </li>
            </ul>
          </div>
        )}

        {choice === 'custom' ? (
          <Field orientation="vertical">
            <FieldLabel>Provider</FieldLabel>
            <Input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={editProvider!.name}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        ) : choice === 'compatibleSDK' ? (
          <Field orientation="vertical">
            <FieldLabel>Provider</FieldLabel>
            <p className="text-xs text-muted-foreground">
              Choose the API format and name for this provider.
            </p>
            <div className="flex gap-2">
              <Select
                value={customFormat}
                onValueChange={(v) => {
                  if (!v) return;
                  setCustomFormat(v as ProviderTypeKey);
                }}
              >
                <SelectTrigger className="w-32">
                  <SelectValue>
                    <span className="flex items-center gap-1.5">
                      <Icon className="size-3.5" />
                      {getProviderEntry(customFormat)?.name.replace(' Compatible', '')}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {compatibleVariants.map((opt) => {
                    const OptIcon = getProviderIcon(opt.type);
                    return (
                      <SelectItem key={opt.type} value={opt.type}>
                        <span className="flex items-center gap-1.5">
                          <OptIcon className="size-3.5" />
                          {opt.name.replace(' Compatible', '')}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Custom Provider"
                className="flex-1"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button
              type="button"
              className="w-auto! self-start text-left text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => {
                setChoice(defaultProvider);
                setCustomName('');
                setCustomFormat('openai_compatible');
                setBaseUrl('');
                setModelId('');
                setReasoning('default');
              }}
            >
              Use a built-in provider instead
            </button>
          </Field>
        ) : (
          <Field orientation="vertical">
            <FieldLabel>Provider</FieldLabel>
            <Select
              value={choice}
              onValueChange={(v) => {
                if (!v) return;
                const next = v as ProviderChoice;
                setChoice(next);
                setModelId('');
                setBaseUrl('');
                setShowBaseUrl(false);
                setReasoning('default');
                if (isEditing) {
                  if (next === initialChoice) {
                    setProviderChanged(false);
                    setEditingKey(false);
                    setApiKey('');
                    setApiKeyEnvVar(editProvider?.secretEnvVar ?? '');
                  } else {
                    setProviderChanged(true);
                    setEditingKey(true);
                    setApiKey('');
                    setApiKeyEnvVar('');
                  }
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  <span className="flex items-center gap-1.5">
                    <Icon className="size-3.5" />
                    {provider.label}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {standardProviders.map((opt) => {
                  const OptIcon = getProviderIcon(opt.type);
                  return (
                    <SelectItem key={opt.type} value={opt.type}>
                      <span className="flex items-center gap-1.5">
                        <OptIcon className="size-3.5" />
                        {opt.name}
                      </span>
                    </SelectItem>
                  );
                })}
                <SelectItem value="compatibleSDK">
                  <span className="flex items-center gap-1.5">
                    <IconServer className="size-3.5" />
                    Custom Provider
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        {requiresAuth && (
          <Field orientation="vertical">
            <FieldLabel>
              <span className="flex flex-1 items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Icon className="size-3.5" />
                  {mode === 'key' ? `${provider.name} API Key` : 'Environment Variable'}
                </span>
                <span className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant={mode === 'key' ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() => setMode('key')}
                  >
                    <IconKey data-icon="inline-start" className="size-3" />
                    API Key
                  </Button>
                  <Button
                    type="button"
                    variant={mode === 'env' ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() => setMode('env')}
                  >
                    <IconVariable data-icon="inline-start" className="size-3" />
                    Env Variable
                  </Button>
                </span>
              </span>
            </FieldLabel>
            {mode === 'key' ? (
              isEditing && !editingKey ? (
                <InputGroup>
                  <InputGroupInput
                    value={
                      editProvider!.secretLast4 ? `••••${editProvider!.secretLast4}` : ''
                    }
                    readOnly
                    placeholder={provider.keyPlaceholder}
                    className="font-mono"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      variant="secondary"
                      size="xs"
                      onClick={() => {
                        setEditingKey(true);
                        setApiKey('');
                      }}
                    >
                      Replace
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              ) : isEditing ? (
                <InputGroup>
                  <InputGroupInput
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditingKey(false);
                        setApiKey('');
                      }
                    }}
                    placeholder={provider.keyPlaceholder}
                    className="font-mono"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setEditingKey(false);
                        setApiKey('');
                      }}
                    >
                      Cancel
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              ) : (
                <Input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={provider.keyPlaceholder}
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
              )
            ) : (
              <Input
                value={apiKeyEnvVar}
                onChange={(e) => setApiKeyEnvVar(e.target.value)}
                placeholder={provider.envPlaceholder}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
        )}

        {baseUrlRequired && (
          <Field orientation="vertical">
            <FieldLabel>Base URL</FieldLabel>
            <Input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://..."
              className="font-mono placeholder:text-muted-foreground/50"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        )}

        {choice !== 'custom' && (
          <Field orientation="vertical">
            <FieldLabel>
              <span className="flex flex-1 items-center justify-between gap-2">
                <span>Model</span>
                {modelOptions.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => modelsCatalog.onRefresh()}
                    disabled={modelsCatalog.isFetching}
                    title="Refresh models"
                  >
                    <IconRefresh
                      className={`size-3 ${modelsCatalog.isFetching ? 'animate-spin' : ''}`}
                    />
                  </Button>
                )}
              </span>
            </FieldLabel>
            {modelOptions.length > 0 ? (
              <Combobox
                items={modelItems}
                value={modelItems.find((i) => i.value === modelId) ?? null}
                onValueChange={(item) => {
                  setModelId(item?.value ?? '');
                }}
                filter={(item, query) => {
                  const q = query.trim().toLowerCase();
                  return (
                    item.label.toLowerCase().includes(q) ||
                    item.value.toLowerCase().includes(q)
                  );
                }}
              >
                <ComboboxInput
                  placeholder="Choose a model"
                  className="w-full"
                  autoComplete="off"
                  spellCheck={false}
                />
                <ComboboxContent>
                  <ComboboxEmpty>No models found.</ComboboxEmpty>
                  <ComboboxList>
                    <ComboboxCollection>
                      {(item: { value: string; label: string }) => (
                        <ComboboxItem key={item.value} value={item}>
                          {item.label}
                        </ComboboxItem>
                      )}
                    </ComboboxCollection>
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            ) : (
              <Input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="model-id"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            )}
            {/* TODO bring this back if we have a 'calibration' available? {estimatedCost != null && (
              <p
                className={`text-xs ${estimatedCost > 20 ? 'text-destructive' : 'text-muted-foreground'}`}
                title={`Based on ~14M input tokens (~50% cached) and ~100k output tokens per book.`}
              >
                ~{formatCost(estimatedCost)} per book
              </p>
            )}*/}
            {contextWarning != null && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <IconAlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  Context window is only {formatContext(contextWarning)}. Book imports
                  need at least {formatContext(MIN_CONTEXT_WINDOW)}.
                </span>
              </p>
            )}
          </Field>
        )}

        {(!baseUrlRequired || choice !== 'custom') && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground [&[data-panel-open]_svg]:rotate-90">
              <IconChevronRight className="size-3 transition-transform" />
              Advanced Settings
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 space-y-4">
                {!baseUrlRequired &&
                  (lockedBaseUrlEntry ? (
                    <Field orientation="vertical">
                      <FieldLabel>Base URL</FieldLabel>
                      <Input
                        type="url"
                        value={lockedBaseUrlEntry.baseUrl}
                        readOnly
                        disabled
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        {lockedBaseUrlEntry.name} official endpoint. Use "Custom Provider"
                        for custom endpoints.
                      </p>
                    </Field>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={showBaseUrl}
                          onCheckedChange={(checked) => {
                            const next = checked === true;
                            setShowBaseUrl(next);
                            if (!next) setBaseUrl('');
                          }}
                        />
                        Custom base URL
                      </label>
                      {showBaseUrl && (
                        <Field orientation="vertical">
                          <Input
                            type="url"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder="https://..."
                            className="font-mono placeholder:text-muted-foreground/50"
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </Field>
                      )}
                    </div>
                  ))}

                {showReasoning && (
                  <Field orientation="vertical">
                    <FieldLabel>Reasoning</FieldLabel>
                    <Select
                      value={reasoning}
                      onValueChange={(v) => {
                        if (!v) return;
                        setReasoning(v as ReasoningLevel | 'default');
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        {supportedReasoningLevels.map((l) => (
                          <SelectItem key={l} value={l}>
                            {REASONING_LABELS[l]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={rpmLimitEnabled}
                        onCheckedChange={(checked) => {
                          setRpmLimitEnabled(checked === true);
                        }}
                      />
                      Provider has a strict RPM limit
                    </label>
                    <Tooltip>
                      <TooltipTrigger className="text-muted-foreground hover:text-foreground">
                        <IconHelp className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Some providers cap requests per minute (RPM) and return errors if
                        you exceed the limit. Setting a value here paces outbound
                        requests.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {rpmLimitEnabled && (
                    <Field orientation="vertical">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={rpmLimit}
                        onChange={(e) => setRpmLimit(e.target.value)}
                        placeholder="e.g. 50"
                        className="font-mono"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </Field>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {saveMutation.isError && (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>Couldn't save provider</AlertTitle>
            <AlertDescription>
              {saveMutation.error?.message || 'An unknown error occurred.'}
            </AlertDescription>
          </Alert>
        )}

        <Button
          className="w-full"
          disabled={
            !credentialReady ||
            (choice !== 'custom' && !modelId) ||
            !baseUrlReady ||
            !customNameReady ||
            saveMutation.isPending
          }
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? 'Saving...' : isEditing ? 'Save' : 'Save & Continue'}
        </Button>

        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground underline underline-offset-2"
          onClick={onBack}
        >
          Back
        </button>
      </div>
    </div>
  );
}
