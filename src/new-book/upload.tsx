import { getModel } from '@earendil-works/pi-ai';
import { decode as base64Decode, encode as base64Encode } from '@stablelib/base64';
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconBooks,
  IconLoader2,
  IconPencil,
  IconPhoto,
  IconUpload
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir, homeDir, join } from '@tauri-apps/api/path';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';

import { ProviderSetup } from '@/components/provider/setup';
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
import { booksQueryOptions } from '@/hooks/queries/books';
import { modelProjectionQueryOptions } from '@/hooks/queries/model-projection';
import { getProvidersForUI, providersQueryOptions } from '@/hooks/queries/settings';
import { useCoverPicker } from '@/hooks/use-cover-picker';
import { useWindowTitle } from '@/hooks/use-window-title';
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from '@/lib/auth';
import { CLOUD_PROVIDER_TYPE } from '@/lib/cloud';
import { linkCloudAccount as linkCloudAccountModel } from '@/lib/cloud-link';
import { broadcastInvalidate } from '@/lib/cross-window-invalidate';
import { createBookImport } from '@/lib/db/models/book-import/create-book-import';
import { setOrganizationTextModel } from '@/lib/db/models/organization-text-model/organization-text-model';
import { upsertProviderModel } from '@/lib/db/models/provider-model/create-provider-model';
import { deleteProviderModelById } from '@/lib/db/models/provider-model/delete-provider-model';
import {
  createProvider,
  createProviderWithModel
} from '@/lib/db/models/provider/create-provider';
import { updateProviderById } from '@/lib/db/models/provider/update-provider';
import type { NewProvider, NewProviderModel, ProviderUpdate } from '@/lib/db/types';
import { isLcpProtected, parseEpub, type EpubEntries } from '@/lib/epub';
import { parseBook } from '@/lib/lit';
import {
  postprocessMarkdown,
  preprocessChapterHtml
} from '@/lib/lit/chapter-to-markdown';
import {
  estimateFromBaseline,
  estimateFromSample,
  type ImportEstimate
} from '@/lib/llm/baseline-model';
import { getProviderEntry, type TestProviderResult } from '@/lib/llm/providers';
import {
  defaultTextProvider,
  hasUsableTextProvider,
  primaryTextModel,
  selectableTextProviders
} from '@/lib/llm/text-model';
import { advanceImport } from '@/lib/pipeline';
import { cn } from '@/lib/utils';
import { NotifyButton } from '@/new-book/notify-button';
import { ImportEstimateRow } from '@/new-book/projection-confirmation';

import bookBgUrl from '../assets/book-bg.svg?url';

type ParsedEpubJson = ReturnType<typeof parseEpub>;

type ValidateEpubResponse =
  | {
      ok: true;
      title: string | null;
      chapterCount: number;
      tokenCount: number;
      coverData?: string;
      coverMediaType?: string;
      parsedJson: ParsedEpubJson;
    }
  | { ok: false; error: string };

function isAcsmName(name: string) {
  return name.toLowerCase().endsWith('.acsm');
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

async function readEpubEntries(path: string): Promise<EpubEntries> {
  const raw = await invoke<Record<string, string>>('read_epub_entries', { path });
  const entries = new Map<string, Uint8Array>();
  for (const [name, b64] of Object.entries(raw)) {
    entries.set(name, base64Decode(b64));
  }
  return entries;
}

async function convertContentsToMarkdown(parsedJson: ParsedEpubJson): Promise<void> {
  const stylesheets = parsedJson.stylesheets ?? [];
  const hrefs = Object.keys(parsedJson.contents).filter(
    (href) => parsedJson.contents[href] != null
  );

  const preprocessed = hrefs.map((href) =>
    preprocessChapterHtml({ html: parsedJson.contents[href]!, css: stylesheets })
  );

  const markdowns = await invoke<string[]>('convert_html_to_markdown', {
    htmls: preprocessed
  });

  hrefs.forEach((href, i) => {
    parsedJson.contents[href] = postprocessMarkdown(markdowns[i]);
  });
}

async function validateEpub(path: string): Promise<ValidateEpubResponse> {
  let entries: EpubEntries;
  try {
    entries = await readEpubEntries(path);
  } catch (e) {
    return {
      ok: false,
      error: `Failed to read EPUB: ${e instanceof Error ? e.message : 'Unknown error'}`
    };
  }

  if (isLcpProtected(entries)) {
    return {
      ok: false,
      error: 'This EPUB is DRM-protected (LCP) and cannot be imported.'
    };
  }

  let parsedJson: ParsedEpubJson;
  try {
    parsedJson = parseEpub(entries);
  } catch (e) {
    return {
      ok: false,
      error: `Invalid EPUB file: ${e instanceof Error ? e.message : 'Unknown error'}`
    };
  }

  try {
    await convertContentsToMarkdown(parsedJson);
  } catch (e) {
    return {
      ok: false,
      error: `Failed to convert chapters to markdown: ${e instanceof Error ? e.message : 'Unknown error'}`
    };
  }

  let parsedBook;
  try {
    parsedBook = await parseBook(parsedJson);
  } catch (e) {
    return {
      ok: false,
      error: `Failed to parse book: ${e instanceof Error ? e.message : 'Unknown error'}`
    };
  }

  const toc = parsedBook.getToc();
  if (!toc.length) return { ok: false, error: 'No table of contents found' };

  const meta = parsedBook.getMetadata();
  return {
    ok: true,
    title: meta.title,
    chapterCount: toc.length,
    tokenCount: parsedBook.getEstimatedTokenCount(),
    coverData: parsedJson.cover?.data,
    coverMediaType: parsedJson.cover?.media_type,
    parsedJson
  };
}

const formProps = {
  listProviders: () => getProvidersForUI(),
  testProviderConfig: (params: {
    providerType: string;
    apiKey: string | null;
    apiKeyEnvVar: string | null;
    baseUrl: string | null;
    modelId: string;
  }) => invoke<TestProviderResult>('test_provider_config', { params }),
  upsertProvider: async (data: NewProvider | (ProviderUpdate & { id?: string })) => {
    if ('id' in data && data.id) {
      const { id, ...rest } = data;
      return updateProviderById(id, rest);
    }
    return createProvider({
      ...data,
      id: uuidv7(),
      organizationId: DEFAULT_ORG_ID
    } as NewProvider);
  },
  upsertProviderModel: ({
    providerId,
    data
  }: {
    providerId: string;
    data: Omit<NewProviderModel, 'providerId'>;
  }) => upsertProviderModel({ ...data, providerId }),
  removeProviderModel: async ({ id }: { id: string }) => {
    await deleteProviderModelById(id);
    return { ok: true } as const;
  },
  createProviderWithModel: ({
    provider,
    model
  }: {
    provider: Omit<NewProvider, 'id' | 'organizationId'>;
    model: Omit<NewProviderModel, 'id' | 'providerId'>;
  }) =>
    createProviderWithModel({
      provider: { ...provider, organizationId: DEFAULT_ORG_ID },
      model
    })
};

function useHasConfiguredSlots() {
  const providers = useQuery(providersQueryOptions);

  const isLoading = providers.isLoading;
  const isConfigured = useMemo(() => {
    if (isLoading || !providers.data) return false;
    return hasUsableTextProvider(providers.data);
  }, [isLoading, providers.data]);

  return { isLoading, isConfigured };
}

export function UploadPage() {
  const queryClient = useQueryClient();
  const { isLoading, isConfigured } = useHasConfiguredSlots();

  useWindowTitle('New Book');

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isConfigured) {
    return (
      <BookFrame
        right={
          <ProviderSetup
            {...formProps}
            linkCloudAccount={async ({ externalId }) => {
              await linkCloudAccountModel(externalId);
              return { ok: true } as const;
            }}
            onOpenExternal={(url) => {
              void openUrl(url);
            }}
            onProvider={() => {
              void queryClient.invalidateQueries({ queryKey: ['providers'] });
              void broadcastInvalidate();
            }}
          />
        }
      />
    );
  }

  return <FileUpload />;
}

function BookFrame({ right }: { right: React.ReactNode }) {
  return (
    <div className="relative flex flex-1">
      <div className="flex w-full flex-1 perspective-[2400px]">
        <div className="relative size-full ring-1 ring-border transform-3d">
          <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden bg-card book-page-gradient-mirror">
            <CoverPane
              customCover={null}
              validation={null}
              displayName={null}
              hideActions
              onChoose={() => {}}
              onRevert={() => {}}
            />
          </div>
          <div className="absolute top-0 right-0 h-full w-1/2">
            <div className="absolute inset-0 overflow-y-auto bg-card book-page-gradient">
              <div className="flex min-h-full pt-10 pb-10">{right}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ACSM_CONVERTER_URL = 'https://www.acsm-converter.com';

function FileUpload() {
  const navigate = useNavigate();
  const providers = useQuery(providersQueryOptions);
  const { pickCoverImage, writeCoverImage } = useCoverPicker();

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidateEpubResponse | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [acsmName, setAcsmName] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [customCover, setCustomCover] = useState<{
    data: string;
    mediaType: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [notifyMe, setNotifyMe] = useState(false);
  const [isSeriesContinuation, setIsSeriesContinuation] = useState(false);
  const [previousBookId, setPreviousBookId] = useState<string | null>(null);
  const pendingFilenameRef = useRef<string | null>(null);

  const seriesBooks = useQuery(booksQueryOptions);
  const previousBookOptions = seriesBooks.data ?? [];

  const textProviders = useMemo(
    () => selectableTextProviders(providers.data ?? []),
    [providers.data]
  );
  const selectedProvider = useMemo(() => {
    const chosen = textProviders.find((p) => p.id === selectedProviderId);
    return chosen ?? defaultTextProvider(providers.data ?? []);
  }, [textProviders, selectedProviderId, providers.data]);

  const tokenCount = validation?.ok ? validation.tokenCount : undefined;
  const analysisModel = useMemo(() => {
    if (!selectedProvider) return null;
    const model = primaryTextModel(selectedProvider);
    if (!model) return null;
    const piProvider = getProviderEntry(selectedProvider.type)?.piProvider ?? null;
    const modelData = piProvider
      ? (getModel(piProvider, model.modelKey as never) ?? null)
      : null;
    return {
      provider: selectedProvider,
      model,
      modelData,
      providerName: selectedProvider.name,
      modelDisplayName: modelData?.name ?? model.displayName ?? model.modelKey
    };
  }, [selectedProvider]);

  const isCloudProvider = analysisModel?.provider.type === CLOUD_PROVIDER_TYPE;

  // Cloud provider uses the baseline model exactly, so skip the projection sample.
  const projectionOptions = modelProjectionQueryOptions(
    analysisModel?.provider.type ?? null,
    analysisModel?.model.modelKey ?? null
  );
  const projectionQuery = useQuery({
    ...projectionOptions,
    enabled: projectionOptions.enabled && !isCloudProvider
  });
  const importEstimate: ImportEstimate | null = useMemo(() => {
    if (tokenCount == null) return null;
    if (isCloudProvider) return estimateFromBaseline({ bookTokens: tokenCount });
    if (!projectionQuery.data) return null;
    return estimateFromSample({
      sample: projectionQuery.data,
      bookTokens: tokenCount
    });
  }, [tokenCount, projectionQuery.data, isCloudProvider]);
  const hasProjection = isCloudProvider || !!projectionQuery.data;

  const handleDroppedPath = useCallback((path: string) => {
    const name = basename(path);
    if (isAcsmName(name)) {
      setAcsmName(name);
      setSelectedPath(null);
      setDisplayName(null);
      setValidation(null);
      return;
    }
    const lower = name.toLowerCase();
    if (!lower.endsWith('.epub') && !lower.endsWith('.epub.zip')) return;
    pendingFilenameRef.current = lower.endsWith('.epub.zip')
      ? name.slice(0, -'.zip'.length)
      : name;
    setAcsmName(null);
    setDisplayName(null);
    setValidation(null);
    setSelectedPath(path);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') {
          setIsDragging(true);
        } else if (payload.type === 'leave') {
          setIsDragging(false);
        } else if (payload.type === 'drop') {
          setIsDragging(false);
          const path = payload.paths?.[0];
          if (path) handleDroppedPath(path);
        }
      });
    })();
    return () => {
      unlisten?.();
    };
  }, [handleDroppedPath]);

  const validate = useCallback(async (path: string) => {
    setIsValidating(true);
    try {
      const result = await validateEpub(path);
      setValidation(result);
      const fallback = pendingFilenameRef.current?.replace(/\.epub$/i, '') ?? null;
      setDisplayName(result.ok ? result.title || fallback : fallback);
    } catch {
      setValidation({ ok: false, error: 'Failed to validate EPUB' });
    } finally {
      setIsValidating(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPath) {
      void validate(selectedPath);
    }
  }, [selectedPath, validate]);

  async function handleNativeDialog() {
    const home = await homeDir();
    const chosen = await openDialog({
      multiple: false,
      directory: false,
      defaultPath: home,
      filters: [{ name: 'EPUB / ACSM', extensions: ['epub', 'acsm'] }]
    });
    if (!chosen || typeof chosen !== 'string') return;
    const name = basename(chosen);
    if (isAcsmName(name)) {
      setAcsmName(name);
      setSelectedPath(null);
      setDisplayName(null);
      setValidation(null);
      return;
    }
    pendingFilenameRef.current = name || null;
    setAcsmName(null);
    setDisplayName(null);
    setValidation(null);
    setSelectedPath(chosen);
  }

  function handleClear() {
    pendingFilenameRef.current = null;
    setSelectedPath(null);
    setDisplayName(null);
    setValidation(null);
    setAcsmName(null);
    setIsEditingTitle(false);
    setTitleDraft('');
    setCustomCover(null);
    setIsSeriesContinuation(false);
    setPreviousBookId(null);
  }

  async function handleChooseCover() {
    try {
      const picked = await pickCoverImage();
      if (!picked) return;
      setCustomCover({ data: base64Encode(picked.bytes), mediaType: picked.mediaType });
    } catch {
      // Surface via errors? skip silently for now.
    }
  }

  function handleRevertCover() {
    setCustomCover(null);
  }

  function handleStartEditTitle() {
    setTitleDraft(displayName ?? '');
    setIsEditingTitle(true);
  }

  function handleUpdateTitle() {
    const next = titleDraft.trim();
    if (!next || next === displayName) {
      setIsEditingTitle(false);
      setTitleDraft(displayName ?? '');
      return;
    }
    setDisplayName(next);
    setIsEditingTitle(false);
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!validation?.ok || !selectedPath) throw new Error('No valid file selected');
      const id = uuidv7();
      const title = displayName?.replace(/\.epub$/i, '') ?? '';

      const coverImage =
        customCover ??
        (validation.coverData && validation.coverMediaType
          ? { data: validation.coverData, mediaType: validation.coverMediaType }
          : null);

      let imageUrl: string | null = null;
      if (coverImage) {
        try {
          imageUrl = await writeCoverImage(
            base64Decode(coverImage.data),
            coverImage.mediaType,
            id
          );
        } catch {
          imageUrl = null;
        }
      }

      const dataDir = await appDataDir();
      const importsDir = await join(dataDir, 'storage', 'imports');
      const parsedJsonPath = await join(importsDir, `${id}.json`);
      await mkdir(importsDir, { recursive: true });
      await writeFile(
        parsedJsonPath,
        new TextEncoder().encode(JSON.stringify(validation.parsedJson))
      );

      const textModelId = analysisModel?.model.id ?? null;
      // Chosen model becomes the org default and is snapshotted onto this import.
      await setOrganizationTextModel({
        textProviderModelId: textModelId,
        textLightProviderModelId: textModelId
      });
      const bookImport = await createBookImport({
        id,
        userId: DEFAULT_USER_ID,
        fileUrl: parsedJsonPath,
        title,
        imageUrl,
        status: 'pending',
        notificationsEnabled: notifyMe,
        autoConfirmProjection: hasProjection,
        textProviderModelId: textModelId,
        textLightProviderModelId: textModelId,
        previousInSeriesBookId: isSeriesContinuation ? previousBookId : null
      });
      if (!bookImport) throw new Error('Failed to create book import');

      await advanceImport(bookImport.id);

      return bookImport.id;
    }
  });

  async function handleContinue() {
    if (!selectedPath || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const work = submitMutation.mutateAsync();
      const [id] = hasProjection
        ? await Promise.all([work, new Promise((r) => setTimeout(r, 900))])
        : [await work];
      await navigate({ to: '/$bookImportId', params: { bookImportId: id } });
    } catch {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative flex flex-1">
      <div className="flex w-full flex-1 perspective-[2400px]">
        <div className="relative size-full ring-1 ring-border transform-3d">
          <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden bg-card book-page-gradient-mirror">
            <CoverPane
              customCover={customCover}
              validation={validation}
              displayName={displayName}
              hideActions={isSubmitting}
              onChoose={handleChooseCover}
              onRevert={handleRevertCover}
            />
          </div>

          <div
            className={cn(
              'absolute top-0 right-0 h-full w-1/2 origin-left transition-transform duration-900 ease-[cubic-bezier(0.645,0.045,0.355,1)] will-change-transform transform-3d',
              isSubmitting && hasProjection && '-rotate-y-180'
            )}
          >
            <div
              className={cn(
                'absolute inset-0 flex flex-col items-center gap-5 overflow-hidden bg-card book-page-gradient px-10 pt-10 text-center transition-colors backface-hidden',
                !selectedPath && !acsmName && 'pb-10',
                !selectedPath && !acsmName && isDragging && 'bg-primary/5',
                isSubmitting && 'pointer-events-none'
              )}
            >
              {acsmName ? (
                <>
                  <p className="text-[10px] tracking-[0.3em] text-destructive uppercase">
                    Not an EPUB
                  </p>
                  <div className="flex flex-col items-center gap-3">
                    <h1 className="font-serif text-xl leading-tight tracking-tight text-balance break-all">
                      {acsmName}
                    </h1>
                    <div className="h-px w-12 bg-border" />
                  </div>
                  <div className="flex items-start gap-2 border border-destructive/50 bg-destructive/10 p-3 text-left">
                    <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
                    <p className="font-serif text-xs text-destructive">
                      .acsm files are Adobe download tokens, not EPUBs. Convert it using{' '}
                      <button
                        type="button"
                        className="underline hover:no-underline"
                        onClick={() => {
                          void openUrl(ACSM_CONVERTER_URL);
                        }}
                      >
                        acsm-converter.com
                      </button>
                      , then drop the resulting .epub here.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    onClick={handleClear}
                  >
                    Choose a different file
                  </button>
                </>
              ) : !selectedPath ? (
                <>
                  <div className="flex flex-col items-center gap-3 text-center">
                    <h2 className="font-serif text-xl tracking-tight text-balance">
                      Import a book
                    </h2>
                    <div className="h-px w-8 bg-border" />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {isDragging
                        ? 'Drop EPUB file'
                        : 'Drag and drop an EPUB file here, or click to choose a file.'}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    onClick={handleNativeDialog}
                  >
                    <IconUpload className="size-3.5" />
                    Choose file
                  </button>
                </>
              ) : (
                <>
                  <p
                    className={cn(
                      'text-[10px] tracking-[0.3em] uppercase',
                      validation && !validation.ok
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    )}
                  >
                    {isValidating
                      ? 'Checking…'
                      : validation?.ok
                        ? 'Ready to Import'
                        : validation && !validation.ok
                          ? 'Invalid EPUB'
                          : 'Loading'}
                  </p>
                  <div className="flex w-full flex-col items-center gap-3">
                    {isEditingTitle ? (
                      <InputGroup className="w-full max-w-xs">
                        <InputGroupInput
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdateTitle();
                            if (e.key === 'Escape') {
                              setIsEditingTitle(false);
                              setTitleDraft(displayName ?? '');
                            }
                          }}
                          autoFocus
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton variant="default" onClick={handleUpdateTitle}>
                            Save
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                    ) : displayName ? (
                      <div className="flex items-center gap-2">
                        <h1 className="font-serif text-2xl leading-tight tracking-tight text-balance">
                          {displayName.length > 30
                            ? `${displayName.slice(0, 30)}…`
                            : displayName}
                        </h1>
                        {validation?.ok && (
                          <button
                            type="button"
                            className="text-muted-foreground/40 hover:text-foreground"
                            onClick={handleStartEditTitle}
                            aria-label="Edit title"
                          >
                            <IconPencil className="size-3.5" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <IconLoader2 className="size-5 animate-spin text-muted-foreground/40" />
                    )}
                    <div className="h-px w-12 bg-border" />
                  </div>

                  {validation?.ok && (
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="flex items-center gap-3 font-serif text-xs text-muted-foreground tabular-nums">
                        <span title="Chapter count is an estimate. Actual count will be determined during processing.">
                          ~{validation.chapterCount} chapters
                        </span>
                        <span className="h-3 w-px bg-border" />
                        <ImportEstimateRow
                          etaMinSeconds={importEstimate?.etaSeconds.min ?? null}
                          etaMaxSeconds={importEstimate?.etaSeconds.max ?? null}
                          costMinCents={importEstimate?.costCents.min ?? null}
                          costMaxCents={importEstimate?.costCents.max ?? null}
                          behavior={importEstimate?.behavior ?? null}
                          etaTitle={
                            isCloudProvider
                              ? 'Estimate based on our benchmark for this model.'
                              : importEstimate
                                ? 'Estimate based on a prior run with this model.'
                                : 'A short sample runs first to estimate time.'
                          }
                          costTitle={
                            isCloudProvider
                              ? 'Estimate based on our benchmark for this model.'
                              : importEstimate
                                ? 'Estimate based on a prior run with this model.'
                                : 'A short sample runs first to estimate cost.'
                          }
                        />
                      </div>
                      {analysisModel && (
                        <div className="flex flex-col items-center gap-1 font-serif text-[11px] text-muted-foreground/70">
                          {textProviders.length > 1 ? (
                            <div className="flex items-center gap-1.5">
                              <Select
                                value={analysisModel.provider.id}
                                onValueChange={(v) => v && setSelectedProviderId(v)}
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="h-7 font-serif text-xs"
                                >
                                  <SelectValue>{analysisModel.providerName}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {textProviders.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {analysisModel.providerName !==
                                analysisModel.modelDisplayName && (
                                <span className="text-foreground/70">
                                  {analysisModel.modelDisplayName}
                                </span>
                              )}
                            </div>
                          ) : analysisModel.providerName ===
                            analysisModel.modelDisplayName ? (
                            <span className="text-foreground/70">
                              {analysisModel.providerName}
                            </span>
                          ) : (
                            <span>
                              {analysisModel.providerName} ·{' '}
                              <span className="text-foreground/70">
                                {analysisModel.modelDisplayName}
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {validation && !validation.ok && (
                    <div className="flex items-start gap-2 border border-destructive/50 bg-destructive/10 p-3 text-left">
                      <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
                      <p className="font-serif text-xs text-destructive">
                        {validation.error}
                      </p>
                    </div>
                  )}

                  {validation?.ok && (
                    <div className="flex flex-col items-center gap-2">
                      {!importEstimate && (
                        <p className="font-serif text-xs leading-relaxed">
                          Since we haven't used this LLM provider before, we'll run a few
                          tests to provide an estimated import time &amp; model cost.
                        </p>
                      )}
                      {importEstimate && (
                        <NotifyButton enabled={notifyMe} onChange={setNotifyMe} />
                      )}
                      <button
                        type="button"
                        disabled={isSeriesContinuation && !previousBookId}
                        className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                        onClick={handleContinue}
                      >
                        {importEstimate ? 'Import book' : 'Estimate Time & Cost'}
                      </button>
                      <SeriesSelector
                        enabled={isSeriesContinuation}
                        onToggle={() => {
                          setIsSeriesContinuation((v) => !v);
                          setPreviousBookId(null);
                        }}
                        books={previousBookOptions}
                        selectedBookId={previousBookId}
                        onSelectBook={setPreviousBookId}
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    className="font-serif text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={handleClear}
                  >
                    Choose a different file
                  </button>
                </>
              )}
            </div>

            <div className="absolute inset-0 rotate-y-180 overflow-hidden bg-card book-page-gradient-mirror backface-hidden" />
          </div>
        </div>
      </div>
    </div>
  );
}

function CoverPane({
  customCover,
  validation,
  displayName,
  hideActions,
  onChoose,
  onRevert
}: {
  customCover: { data: string; mediaType: string } | null;
  validation: ValidateEpubResponse | null;
  displayName: string | null;
  hideActions: boolean;
  onChoose: () => void;
  onRevert: () => void;
}) {
  const customCoverDataUrl = customCover
    ? `data:${customCover.mediaType};base64,${customCover.data}`
    : null;
  const epubCoverDataUrl =
    validation?.ok && validation.coverData && validation.coverMediaType
      ? `data:${validation.coverMediaType};base64,${validation.coverData}`
      : null;
  const coverDataUrl = customCoverDataUrl ?? epubCoverDataUrl;
  const showActions = validation?.ok === true && !hideActions;

  if (coverDataUrl) {
    return (
      <div className="relative size-full overflow-hidden">
        <img
          src={coverDataUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full scale-110 object-cover blur-xl"
        />
        <img
          src={coverDataUrl}
          alt={displayName ?? 'Book cover'}
          className="relative size-full object-contain"
        />
        {showActions && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
            {customCover ? (
              <button
                type="button"
                className="flex items-center gap-1.5 bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border/60 backdrop-blur-sm hover:bg-background"
                onClick={onRevert}
              >
                <IconArrowBackUp className="size-3.5" />
                Revert
              </button>
            ) : (
              <button
                type="button"
                className="flex items-center gap-1.5 bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border/60 backdrop-blur-sm hover:bg-background"
                onClick={onChoose}
              >
                <IconPhoto className="size-3.5" />
                Change cover
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex size-full flex-col items-center justify-center gap-4">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${bookBgUrl})`,
          backgroundRepeat: 'repeat'
        }}
      />
      {showActions && (
        <button
          type="button"
          className="relative flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onClick={onChoose}
        >
          <IconPhoto className="size-3.5" />
          Add cover
        </button>
      )}
    </div>
  );
}

function SeriesSelector({
  enabled,
  onToggle,
  books,
  selectedBookId,
  onSelectBook
}: {
  enabled: boolean;
  onToggle: () => void;
  books: { id: string; title: string }[];
  selectedBookId: string | null;
  onSelectBook: (id: string) => void;
}) {
  const selectedBook = books.find((book) => book.id === selectedBookId);
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium',
          enabled
            ? 'text-muted-foreground'
            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
        )}
        onClick={onToggle}
      >
        <IconBooks className="size-3.5" />
        Next book in a series?
      </button>
      {enabled &&
        (books.length > 0 ? (
          <div className="flex flex-col items-center gap-1.5">
            <p className="max-w-xs font-serif text-xs leading-relaxed text-muted-foreground">
              If this is <em>not</em> the first book in the series, select the previous
              book so characters and places carry over
              <br /> (e.g. if this is book 3, select book 2).
              <br />
            </p>

            <Select
              value={selectedBookId ?? ''}
              onValueChange={(v) => v && onSelectBook(v)}
            >
              <SelectTrigger size="sm" className="h-7 w-64 max-w-full font-serif text-xs">
                <SelectValue placeholder="Select the previous book">
                  {selectedBook?.title}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {books.map((book) => (
                  <SelectItem key={book.id} value={book.id}>
                    {book.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <p className="max-w-xs font-serif text-xs leading-relaxed text-muted-foreground">
              If you haven't imported the previous book yet, do that first before
              importing this one.
            </p>
          </div>
        ) : (
          <p className="max-w-xs font-serif text-xs leading-relaxed text-muted-foreground">
            Is this the first book in the series? If not, import the previous book first,
            then return to import this one.
          </p>
        ))}
      {enabled && (
        <button
          type="button"
          className="mb-4 font-serif text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={onToggle}
        >
          This is the first book in the series
        </button>
      )}
    </div>
  );
}
