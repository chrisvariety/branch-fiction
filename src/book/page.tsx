import {
  IconCloud,
  IconDeviceMobile,
  IconDots,
  IconFileExport,
  IconKey,
  IconPencil,
  IconPhoto,
  IconPuzzle,
  IconSettings,
  IconUsers
} from '@tabler/icons-react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, message, save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useRef, useState } from 'react';

import { CloudAccess } from '@/components/cloud/access';
import { ConsentScreen } from '@/components/extension/consent';
import { PhoneShareDialog } from '@/components/phone-share-dialog';
import { Titlebar } from '@/components/titlebar';
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
import { linkCloudAccount as linkCloudAccountModel } from '@/lib/cloud-link';
import { broadcastInvalidate } from '@/lib/cross-window-invalidate';
import { getBookImportByBookId } from '@/lib/db/models/book-import/get-book-import';
import { updateBookImportById } from '@/lib/db/models/book-import/update-book-import';
import { deleteBookById } from '@/lib/db/models/book/delete-book';
import { getBookById } from '@/lib/db/models/book/get-book';
import { updateBookById } from '@/lib/db/models/book/update-book';
import type { Book } from '@/lib/db/types';
import { extensionAssetUrl, transformImageUrl } from '@/lib/media/transform-url';
import { BookCoverFigure } from '@/main/book-cover';

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
};

export function BookPage() {
  const { bookId } = useParams({ strict: false }) as { bookId?: string };
  const id = bookId ?? '';

  const { data: book } = useQuery({
    queryKey: ['book', id],
    queryFn: () => getBookById(id),
    enabled: !!id
  });
  const { data: extensions } = useSuspenseQuery(extensionsQueryOptions);
  const { data: bindings } = useSuspenseQuery(extensionBindingsQueryOptions);

  const [editing, setEditing] = useState(false);
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
      setPhoneTarget({ extensionId: extension.id, extensionName: extension.name, entry });
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

  return (
    <>
      <Titlebar
        title={book?.title ?? 'Book'}
        rightActions={
          book && (
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
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <IconPencil className="size-4 shrink-0 text-muted-foreground" />
                  Rename
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
          )
        }
      />
      <section className="flex min-w-0 flex-1 flex-col p-6 md:p-8">
        {editing && book ? (
          <BookSettings book={book} onClose={() => setEditing(false)} />
        ) : setupTarget && setupExtension ? (
          <ExtensionSetupFlow
            key={setupTarget.extensionId}
            extension={setupExtension}
            bindings={bindings.filter((b) => b.extensionId === setupExtension.id)}
            onLaunch={() => launch(setupExtension, setupTarget.intent)}
            onClose={() => setSetupTarget(null)}
          />
        ) : tiles.length === 0 ? (
          <EmptyState />
        ) : (
          <ExtensionGrid extensions={tiles} onActivate={handleActivate} />
        )}
      </section>
      {phoneTarget && (
        <PhoneShareDialog
          open={!!phoneTarget}
          onOpenChange={(o) => !o && setPhoneTarget(null)}
          extensionId={phoneTarget.extensionId}
          extensionName={phoneTarget.extensionName}
          entry={phoneTarget.entry}
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
  const [view, setView] = useState<'chooser' | 'cloud' | 'byok'>('chooser');

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
    if (view === 'cloud') {
      return (
        <div className="mx-auto w-full max-w-md">
          <CloudAccess
            onBack={() => setView('chooser')}
            onOpenExternal={(url) => {
              void openUrl(url);
            }}
            invalidationQueryKeys={[
              ['providers'],
              ['extensions'],
              ['extension-bindings']
            ]}
            linkCloudAccount={async (externalId) => {
              await linkCloudAccountModel(externalId);
              void broadcastInvalidate();
            }}
          />
        </div>
      );
    }
    if (view === 'byok') {
      return (
        <ExtensionConfigureStep
          extensionId={extension.id}
          onSuccess={launchAndClose}
          onClose={() => setView('chooser')}
        />
      );
    }
    return (
      <ExtensionProviderChooser
        extensionName={extension.name}
        onCloud={() => setView('cloud')}
        onByok={() => setView('byok')}
        onCancel={onClose}
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

function ExtensionProviderChooser({
  extensionName,
  onCloud,
  onByok,
  onCancel
}: {
  extensionName: string;
  onCloud: () => void;
  onByok: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <h2 className="font-serif text-xl tracking-tight text-balance">
          Choose a provider
        </h2>
        <div className="h-px w-8 bg-border" />
      </div>

      <div className="mt-6 w-full max-w-sm space-y-6">
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          {extensionName} needs an LLM provider. Pick how you'd like to connect.
        </p>

        <div className="space-y-2">
          <button
            type="button"
            onClick={onCloud}
            className="flex w-full items-start gap-3 border border-border p-4 text-left transition-colors hover:bg-muted/40"
          >
            <IconCloud className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Cloud Access</p>
              <p className="text-xs text-muted-foreground">
                One subscription, no API keys to manage.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={onByok}
            className="flex w-full items-start gap-3 border border-border p-4 text-left transition-colors hover:bg-muted/40"
          >
            <IconKey className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Bring your own key</p>
              <p className="text-xs text-muted-foreground">
                Use your own API keys for the providers this extension needs.
              </p>
            </div>
          </button>
        </div>

        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground underline underline-offset-2"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
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

function BookSettings({ book, onClose }: { book: Book; onClose: () => void }) {
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

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
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
              <InputGroupButton variant="default" onClick={() => void handleSaveTitle()}>
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

      <div className="flex flex-col items-center gap-3">
        <div className="w-32">
          <BookCoverFigure title={book.title} imageUrl={coverUrl} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            className="flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            onClick={() => void handleChooseCover()}
          >
            <IconPhoto className="size-3.5" />
            {coverUrl ? 'Change cover' : 'Add cover'}
          </button>
          {coverUrl && (
            <button
              type="button"
              disabled={busy}
              className="bg-muted px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/80 disabled:opacity-60"
              onClick={() => void handleRemoveCover()}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        className="font-serif text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={onClose}
      >
        Done
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="max-w-sm text-sm text-muted-foreground">
        No extensions are enabled. Enable an extension to start exploring this book.
      </p>
      <button
        type="button"
        onClick={openSettingsToExtensions}
        className="flex items-center gap-1.5 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <IconSettings className="size-3.5" />
        Open extension settings
      </button>
    </div>
  );
}

function ExtensionGrid({
  extensions,
  onActivate
}: {
  extensions: InstalledExtension[];
  onActivate: (extension: InstalledExtension, intent: LaunchIntent) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-x-6 gap-y-8 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {extensions.map((p) => (
        <ExtensionTile
          key={p.id}
          extension={p}
          onLaunch={() => onActivate(p, 'open')}
          onOpenOnPhone={() => onActivate(p, 'phone')}
        />
      ))}
    </div>
  );
}

function ExtensionTile({
  extension,
  onLaunch,
  onOpenOnPhone
}: {
  extension: InstalledExtension;
  onLaunch: () => void;
  onOpenOnPhone: () => void;
}) {
  const phoneCompatible = !!extension.manifest.path?.phoneCompatible;

  if (!phoneCompatible) {
    return (
      <button
        type="button"
        onClick={onLaunch}
        className="group flex flex-col items-center gap-2 text-center outline-none"
      >
        <ExtensionIcon extension={extension} />
        <ExtensionLabel name={extension.name} />
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="group flex flex-col items-center gap-2 text-center outline-none"
          />
        }
      >
        <ExtensionIcon extension={extension} />
        <ExtensionLabel name={extension.name} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={6} className="w-48">
        <DropdownMenuItem onClick={onLaunch}>Open</DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenOnPhone}>
          <IconDeviceMobile className="size-4 shrink-0 text-muted-foreground" />
          Open on Phone
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExtensionIcon({ extension }: { extension: InstalledExtension }) {
  const iconPath = extension.manifest.path?.icon;
  const [failed, setFailed] = useState(false);
  const src = iconPath ? extensionAssetUrl(extension.id, iconPath) : null;

  return (
    <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl bg-muted/60 ring-1 ring-border transition-transform group-hover:-translate-y-0.5 group-hover:shadow-md">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <IconPuzzle className="size-1/2 text-muted-foreground/60" />
      )}
    </div>
  );
}

function ExtensionLabel({ name }: { name: string }) {
  return (
    <span className="line-clamp-2 max-w-full text-xs text-foreground/90">{name}</span>
  );
}
