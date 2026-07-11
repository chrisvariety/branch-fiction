import {
  IconChevronRight,
  IconDeviceMobile,
  IconDots,
  IconFileExport,
  IconPencil,
  IconPhoto,
  IconPuzzle,
  IconTrash,
  IconUsers
} from '@tabler/icons-react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, message, save } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState } from 'react';

import { ConsentScreen } from '@/components/extension/consent';
import { PhoneShareDialog } from '@/components/phone-share-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group';
import { stageExtensionConfigure } from '@/extensions/install';
import { extensionNeedsSetup } from '@/extensions/needs-setup';
import { openExtensionPath } from '@/extensions/open-path';
import {
  extensionBindingsQueryOptions,
  extensionsQueryOptions,
  type InstalledExtension
} from '@/hooks/queries/extensions';
import { providersQueryOptions } from '@/hooks/queries/settings';
import { useCoverPicker } from '@/hooks/use-cover-picker';
import { useWindowTitle } from '@/hooks/use-window-title';
import { broadcastInvalidate } from '@/lib/cross-window-invalidate';
import { getBookImportByBookId } from '@/lib/db/models/book-import/get-book-import';
import { updateBookImportById } from '@/lib/db/models/book-import/update-book-import';
import { deleteBookById } from '@/lib/db/models/book/delete-book';
import { getBookById } from '@/lib/db/models/book/get-book';
import { updateBookById } from '@/lib/db/models/book/update-book';
import type { Book } from '@/lib/db/types';
import { extensionAssetUrl, transformImageUrl } from '@/lib/media/transform-url';

import bookBgUrl from '../assets/book-bg.svg?url';

function isDark() {
  return document.documentElement.classList.contains('dark');
}

function openSettingsToExtensions() {
  void invoke('open_settings_window', { route: '/extensions', dark: isDark() });
}

type LaunchIntent = 'open' | 'phone';

type PhoneTarget = {
  extensionId: string;
  extensionName: string;
  entry: string;
  cloudOnly: boolean;
};

export function BookPage() {
  const { bookId } = useParams({ strict: false }) as { bookId?: string };
  const id = bookId ?? '';

  const { data: book, isPending } = useQuery({
    queryKey: ['book', id],
    queryFn: () => getBookById(id),
    enabled: !!id
  });
  const { data: extensions } = useSuspenseQuery(extensionsQueryOptions);
  const { data: bindings } = useSuspenseQuery(extensionBindingsQueryOptions);

  const [setupTarget, setSetupTarget] = useState<{
    extensionId: string;
    intent: LaunchIntent;
  } | null>(null);
  const [phoneTarget, setPhoneTarget] = useState<PhoneTarget | null>(null);

  useWindowTitle(book?.title);

  const tiles = extensions.filter((p) => p.enabled && !!p.manifest.path?.entry);

  const launch = (extension: InstalledExtension, intent: LaunchIntent) => {
    if (intent === 'phone') {
      const entry = extension.manifest.path?.entry;
      if (!entry) return;
      setPhoneTarget({
        extensionId: extension.id,
        extensionName: extension.name,
        entry,
        cloudOnly: extension.manifest.path?.phoneCompatible === 'cloud'
      });
      return;
    }
    void openExtensionPath({ extensionId: extension.id, bookId: id });
  };

  const handleActivate = (extension: InstalledExtension, intent: LaunchIntent) => {
    const needsConfig = extensionNeedsSetup(
      extension.manifest,
      extension.config,
      bindings.filter((b) => b.extensionId === extension.id)
    );
    if (needsConfig) setSetupTarget({ extensionId: extension.id, intent });
    else launch(extension, intent);
  };

  const setupExtension = setupTarget
    ? (extensions.find((p) => p.id === setupTarget.extensionId) ?? null)
    : null;

  const { data: canUpdateSelection = false } = useQuery({
    queryKey: ['import-updatable', id],
    queryFn: async () => !!(await getBookImportByBookId(id)),
    enabled: !!id
  });

  const handleUpdateSelection = async () => {
    const bookImport = await getBookImportByBookId(id);
    if (!bookImport) return;
    try {
      await invoke('ensure_import_db', { bookImportId: bookImport.id, bookId: id });
    } catch (e) {
      await message(String(e), { title: 'Update Failed', kind: 'error' });
      return;
    }
    await updateBookImportById(bookImport.id, { status: 'awaiting_selection' });
    await broadcastInvalidate();
    void invoke('open_import_window', { bookImportId: bookImport.id, dark: isDark() });
  };

  const handleExport = async () => {
    if (!book) return;
    const dest = await save({
      defaultPath: `${book.slug}.bfbook`,
      filters: [{ name: 'Branch Fiction Book', extensions: ['bfbook'] }]
    });
    if (!dest) return;
    try {
      await invoke('export_book_archive', { bookId: id, destPath: dest });
    } catch (e) {
      await message(String(e), { title: 'Export Failed', kind: 'error' });
    }
  };

  const handleDelete = async () => {
    const confirmed = await ask(
      'This permanently removes the book and everything generated for it. This cannot be undone.',
      {
        title: 'Delete Book',
        kind: 'warning',
        okLabel: 'Delete Book',
        cancelLabel: 'Keep Book'
      }
    );
    if (!confirmed) return;
    await deleteBookById(id);
    await broadcastInvalidate();
    await getCurrentWindow().close();
  };

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm text-muted-foreground">Book not found</p>
        <p className="max-w-xs text-xs text-muted-foreground/70">
          This book may have been deleted. You can close this window.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="absolute top-10 right-3 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80"
            aria-label="Book actions"
          >
            <IconDots className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!canUpdateSelection}
              onClick={handleUpdateSelection}
            >
              <IconUsers className="size-4 shrink-0 text-muted-foreground" />
              Update
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={book.status !== 'completed'}
              onClick={() => void handleExport()}
            >
              <IconFileExport className="size-4 shrink-0 text-muted-foreground" />
              Export…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleDelete}>
              Delete Book
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {setupTarget && setupExtension ? (
        <section className="flex min-w-0 flex-1 flex-col p-6 md:p-8">
          <ExtensionSetupFlow
            key={setupTarget.extensionId}
            extension={setupExtension}
            bindings={bindings.filter((b) => b.extensionId === setupExtension.id)}
            onLaunch={() => launch(setupExtension, setupTarget.intent)}
            onClose={() => setSetupTarget(null)}
          />
        </section>
      ) : (
        <BookView book={book} extensions={tiles} onActivate={handleActivate} />
      )}
      {phoneTarget && (
        <PhoneShareDialog
          open={!!phoneTarget}
          onOpenChange={(o) => !o && setPhoneTarget(null)}
          extensionId={phoneTarget.extensionId}
          extensionName={phoneTarget.extensionName}
          entry={phoneTarget.entry}
          cloudOnly={phoneTarget.cloudOnly}
          bookId={id}
        />
      )}
    </>
  );
}

function ExtensionSetupFlow({
  extension,
  bindings,
  onLaunch,
  onClose
}: {
  extension: InstalledExtension;
  bindings: { providerKey: string }[];
  onLaunch: () => void;
  onClose: () => void;
}) {
  const providers = useQuery(providersQueryOptions);

  const hasProviders = (providers.data?.length ?? 0) > 0;
  const needsConfig = extensionNeedsSetup(extension.manifest, extension.config, bindings);

  const launchedRef = useRef(false);
  const launchAndClose = () => {
    if (launchedRef.current) return;
    launchedRef.current = true;
    onLaunch();
    onClose();
  };

  // Cloud auto-configure can finish setup on its own; launch as soon as nothing is missing.
  const ready = !!providers.data && hasProviders && !needsConfig;
  useEffect(() => {
    if (ready) launchAndClose();
  }, [ready]);

  if (!providers.data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!hasProviders) {
    return (
      <ExtensionConfigureStep
        extensionId={extension.id}
        onSuccess={launchAndClose}
        onClose={onClose}
      />
    );
  }

  if (needsConfig) {
    return (
      <ExtensionConfigureStep
        extensionId={extension.id}
        onSuccess={launchAndClose}
        onClose={onClose}
      />
    );
  }

  return null;
}

function ExtensionConfigureStep({
  extensionId,
  onSuccess,
  onClose
}: {
  extensionId: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  // Staging resolves requirements against current providers, so keep it fresh per visit.
  const staged = useQuery({
    queryKey: ['extension-configure', extensionId],
    queryFn: () => stageExtensionConfigure(extensionId),
    staleTime: 0,
    gcTime: 0
  });

  if (staged.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="max-w-sm text-xs text-destructive">
          {staged.error instanceof Error ? staged.error.message : String(staged.error)}
        </p>
        <button
          type="button"
          className="font-serif text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={onClose}
        >
          Back
        </button>
      </div>
    );
  }

  if (!staged.data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <ConsentScreen
        staged={staged.data}
        variant="setup"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </div>
  );
}

function BookView({
  book,
  extensions,
  onActivate
}: {
  book: Book;
  extensions: InstalledExtension[];
  onActivate: (extension: InstalledExtension, intent: LaunchIntent) => void;
}) {
  const queryClient = useQueryClient();
  const { pickCoverImage, writeCoverImage } = useCoverPicker();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const coverUrl = book.imageUrl ? transformImageUrl(book.imageUrl) : null;

  const persist = async (update: Parameters<typeof updateBookById>[1]) => {
    setBusy(true);
    try {
      await updateBookById(book.id, update);
      await queryClient.invalidateQueries({ queryKey: ['book', book.id] });
      await broadcastInvalidate();
    } finally {
      setBusy(false);
    }
  };

  const startEditTitle = () => {
    setTitleDraft(book.title);
    setIsEditingTitle(true);
  };

  const handleSaveTitle = async () => {
    const next = titleDraft.trim();
    setIsEditingTitle(false);
    if (!next || next === book.title) return;
    await persist({ title: next });
  };

  const handleChooseCover = async () => {
    const picked = await pickCoverImage();
    if (!picked) return;
    const imageUrl = await writeCoverImage(picked.bytes, picked.mediaType);
    await persist({ imageUrl });
  };

  const handleRemoveCover = async () => {
    const confirmed = await ask(
      "This removes the book's cover. You'll need to choose a new image to restore one.",
      {
        title: 'Remove Cover',
        kind: 'warning',
        okLabel: 'Remove Cover',
        cancelLabel: 'Keep Cover'
      }
    );
    if (!confirmed) return;
    await persist({ imageUrl: null });
  };

  const coverActions = coverUrl ? (
    <>
      <button
        type="button"
        disabled={busy}
        className="flex items-center gap-1.5 bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border/60 backdrop-blur-sm hover:bg-background disabled:opacity-60"
        onClick={() => void handleChooseCover()}
      >
        <IconPhoto className="size-3.5" />
        Change cover
      </button>
      <button
        type="button"
        disabled={busy}
        className="flex items-center gap-1.5 bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border/60 backdrop-blur-sm hover:bg-background disabled:opacity-60"
        onClick={() => void handleRemoveCover()}
      >
        <IconTrash className="size-3.5" />
        Remove
      </button>
    </>
  ) : (
    <button
      type="button"
      disabled={busy}
      className="flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      onClick={() => void handleChooseCover()}
    >
      <IconPhoto className="size-3.5" />
      Add cover
    </button>
  );

  return (
    <div className="relative flex flex-1">
      <div className="flex w-full flex-1 perspective-[2400px]">
        <div className="relative size-full ring-1 ring-border transform-3d">
          <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden bg-card book-page-gradient-mirror">
            <BookCoverPane
              title={book.title}
              coverUrl={coverUrl}
              actions={coverActions}
            />
          </div>

          <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden bg-card book-page-gradient">
            <div className="absolute inset-0 flex flex-col overflow-y-auto px-10 pt-10 pb-10">
              <div className="flex flex-col items-center gap-3 text-center">
                {isEditingTitle ? (
                  <InputGroup className="w-full max-w-xs">
                    <InputGroupInput
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveTitle();
                        if (e.key === 'Escape') setIsEditingTitle(false);
                      }}
                      autoFocus
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        variant="default"
                        onClick={() => void handleSaveTitle()}
                      >
                        Save
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                ) : (
                  <div className="relative">
                    <h2 className="font-serif text-xl tracking-tight text-balance">
                      {book.title}
                    </h2>
                    <button
                      type="button"
                      className="absolute top-1/2 left-full ml-2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground"
                      onClick={startEditTitle}
                      aria-label="Edit title"
                    >
                      <IconPencil className="size-3.5" />
                    </button>
                  </div>
                )}
                <div className="h-px w-8 bg-border" />
              </div>

              <div className="mt-6 flex-1">
                {extensions.length === 0 ? (
                  <p className="text-center text-xs leading-relaxed text-muted-foreground">
                    No extensions are enabled yet. Install one to start exploring this
                    book.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {extensions.map((extension) => (
                      <ExtensionRow
                        key={extension.id}
                        extension={extension}
                        onActivate={onActivate}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={openSettingsToExtensions}
                  className="flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <IconPuzzle className="size-3.5" />
                  Install extensions
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BookCoverPane({
  title,
  coverUrl,
  actions
}: {
  title: string;
  coverUrl: string | null;
  actions: React.ReactNode;
}) {
  if (coverUrl) {
    return (
      <div className="relative size-full overflow-hidden">
        <img
          src={coverUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full scale-110 object-cover blur-xl"
        />
        <img src={coverUrl} alt={title} className="relative size-full object-contain" />
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
          {actions}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex size-full items-center justify-center">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ backgroundImage: `url(${bookBgUrl})`, backgroundRepeat: 'repeat' }}
      />
      <div className="relative flex items-center gap-2">{actions}</div>
    </div>
  );
}

function ExtensionRow({
  extension,
  onActivate
}: {
  extension: InstalledExtension;
  onActivate: (extension: InstalledExtension, intent: LaunchIntent) => void;
}) {
  const phoneCompatible = !!extension.manifest.path?.phoneCompatible;

  if (!phoneCompatible) {
    return (
      <button
        type="button"
        onClick={() => onActivate(extension, 'open')}
        className="flex w-full items-center gap-3 border border-border p-3 text-left transition-colors hover:bg-muted/40"
      >
        <ExtensionRowIcon extension={extension} />
        <ExtensionRowLabel extension={extension} />
      </button>
    );
  }

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center gap-3 border border-border p-3 text-left transition-colors hover:bg-muted/40 [&[data-panel-open]_.chevron]:rotate-90">
        <ExtensionRowIcon extension={extension} />
        <ExtensionRowLabel extension={extension} />
        <IconChevronRight className="chevron ml-auto size-4 shrink-0 text-muted-foreground transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col border-x border-b border-border">
          <button
            type="button"
            onClick={() => onActivate(extension, 'open')}
            className="flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40"
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => onActivate(extension, 'phone')}
            className="flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40"
          >
            <IconDeviceMobile className="size-4 shrink-0 text-muted-foreground" />
            Open on Phone
          </button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ExtensionRowLabel({ extension }: { extension: InstalledExtension }) {
  const { description } = extension.manifest;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-medium">{extension.name}</span>
      {description && (
        <span className="line-clamp-2 text-xs text-muted-foreground">{description}</span>
      )}
    </span>
  );
}

function ExtensionRowIcon({ extension }: { extension: InstalledExtension }) {
  const iconPath = extension.manifest.path?.icon;
  const [failed, setFailed] = useState(false);
  const src = iconPath ? extensionAssetUrl(extension.id, iconPath) : null;

  if (!src || failed) return null;

  return (
    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/60 ring-1 ring-border">
      <img
        src={src}
        alt=""
        className="size-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
