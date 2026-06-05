import { IconDots, IconLoader2, IconPlus, IconX } from '@tabler/icons-react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { useMemo, useState } from 'react';

import { openBookWindow } from '@/book/open-book';
import { Titlebar } from '@/components/titlebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { activeImportsQueryOptions } from '@/hooks/queries/active-imports';
import { booksQueryOptions } from '@/hooks/queries/books';
import { BookCover } from '@/main/book-cover';
import { SeedWelcome } from '@/main/seed-welcome';

type Layout = 'grid' | 'list';
type Sort = 'recent' | 'title';

function isDark() {
  return document.documentElement.classList.contains('dark');
}

function openNewBook() {
  void invoke('open_new_book_window', { dark: isDark() });
}

function openImport(bookImportId: string) {
  void invoke('open_import_window', { bookImportId, dark: isDark() });
}

function usePersisted<T extends string>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(
    () => (localStorage.getItem(key) as T | null) ?? fallback
  );
  const set = (next: T) => {
    localStorage.setItem(key, next);
    setValue(next);
  };
  return [value, set] as const;
}

export function BooksPage() {
  const { data: books } = useSuspenseQuery(booksQueryOptions);
  const { data: activeImports } = useSuspenseQuery(activeImportsQueryOptions);

  const [view, setView] = useState<'books' | 'imports'>('books');
  const [layout, setLayout] = usePersisted<Layout>('books-layout', 'grid');
  const [sort, setSort] = usePersisted<Sort>('books-sort', 'recent');

  const sortedBooks = useMemo(
    () =>
      sort === 'title'
        ? [...books].sort((a, b) => a.title.localeCompare(b.title))
        : books,
    [books, sort]
  );

  const onlySeedBooks =
    books.length > 0 && books.every((book) => book.isSeed) && activeImports.length === 0;

  const showingImports = view === 'imports' && activeImports.length > 0;
  const anyImportRunning = activeImports.some(
    (imp) =>
      (imp.status === 'pending' ||
        imp.status === 'projection' ||
        imp.status === 'extract' ||
        imp.status === 'arc') &&
      imp.isActive
  );

  return (
    <>
      <Titlebar
        title={showingImports ? 'Book Imports' : 'Books'}
        rightActions={
          <div className="flex items-center gap-2">
            {activeImports.length > 0 && (
              <button
                className={`flex h-7 items-center rounded-full text-xs font-medium ${
                  showingImports
                    ? 'size-7 justify-center bg-primary text-primary-foreground hover:bg-primary/80'
                    : 'gap-1.5 bg-muted px-2.5 text-muted-foreground hover:bg-muted/80'
                }`}
                onClick={() => setView(showingImports ? 'books' : 'imports')}
                aria-label={showingImports ? 'Close imports' : 'Show pending imports'}
              >
                {showingImports ? (
                  <IconX className="size-4" stroke={3} />
                ) : (
                  <>
                    {anyImportRunning && (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    )}
                    <span>
                      {activeImports.length}{' '}
                      {activeImports.length === 1 ? 'import' : 'imports'}
                    </span>
                  </>
                )}
              </button>
            )}
            {books.length > 0 && !showingImports && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80"
                  aria-label="View options"
                >
                  <IconDots className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuRadioGroup
                    value={layout}
                    onValueChange={(value) => setLayout(value as Layout)}
                  >
                    <DropdownMenuLabel>View</DropdownMenuLabel>
                    <DropdownMenuRadioItem value="grid">Grid</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="list">List</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={sort}
                    onValueChange={(value) => setSort(value as Sort)}
                  >
                    <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                    <DropdownMenuRadioItem value="recent">Recent</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="title">Title</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!showingImports && (
              <button
                className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/80"
                onClick={() => openNewBook()}
                aria-label="Add a book"
              >
                <IconPlus className="size-4" stroke={3} />
              </button>
            )}
          </div>
        }
      />
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <section className="flex min-w-0 flex-1 flex-col p-3 md:p-4 lg:p-6">
          {showingImports ? (
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {activeImports.map((imp) => (
                <BookCover
                  key={imp.id}
                  title={imp.title}
                  imageUrl={imp.imageUrl}
                  importStatus={imp.status}
                  importActive={imp.isActive}
                  onClick={() => openImport(imp.id)}
                />
              ))}
            </div>
          ) : books.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-muted-foreground">No books yet.</p>
            </div>
          ) : onlySeedBooks ? (
            <SeedWelcome
              books={sortedBooks}
              onOpenBook={(id) => void openBookWindow(id)}
            />
          ) : layout === 'list' ? (
            <div className="flex flex-col divide-y divide-border/60">
              {sortedBooks.map((book) => (
                <button
                  key={book.id}
                  type="button"
                  className="flex items-center gap-3 px-2 py-2 text-left hover:bg-muted/40"
                  onClick={() => void openBookWindow(book.id)}
                >
                  <div className="aspect-2/3 w-10 shrink-0 overflow-hidden rounded-xs ring-1 ring-border">
                    {book.imageUrl ? (
                      <img
                        src={book.imageUrl}
                        alt={book.title}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-muted p-1">
                        <p className="line-clamp-3 text-center text-[10px] font-medium text-muted-foreground">
                          {book.title}
                        </p>
                      </div>
                    )}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {book.title}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {sortedBooks.map((book) => (
                <BookCover
                  key={book.id}
                  title={book.title}
                  imageUrl={book.imageUrl}
                  onClick={() => void openBookWindow(book.id)}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
