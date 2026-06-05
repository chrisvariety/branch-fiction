import { BookCover } from '@/main/book-cover';

interface SeedWelcomeBook {
  id: string;
  title: string;
  imageUrl: string | null;
}

interface SeedWelcomeProps {
  books: SeedWelcomeBook[];
  onOpenBook: (id: string) => void;
}

// Playful curve dipping down then sweeping right onto the book, open ">" tip.
function ArrowToBook({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 46"
      width="80"
      height="46"
      className={className}
      aria-hidden="true"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 6 6 C 14 24, 44 34, 74 36" />
        <path d="M 66 29.5 L 74 36 L 65.5 41" />
      </g>
    </svg>
  );
}

// Playful curve swooping up toward the add button, open ">" tip.
function ArrowToImport({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 68 64"
      width="68"
      height="64"
      className={className}
      aria-hidden="true"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 10 58 C 36 54, 52 40, 56 14" />
        <path d="M 49 21 L 56 14 L 60.5 23" />
      </g>
    </svg>
  );
}

export function SeedWelcome({ books, onOpenBook }: SeedWelcomeProps) {
  return (
    <div className="relative flex flex-1 items-center justify-center">
      <div className="pointer-events-none absolute top-2 right-4 flex items-end gap-1.5 text-muted-foreground">
        <span className="rotate-2 text-sm font-medium">… or import your own</span>
        <ArrowToImport />
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute right-full bottom-full -mr-2 -mb-3 flex w-max flex-col items-start gap-1 text-muted-foreground">
          <span className="-rotate-2 text-sm font-medium">Try our sample book</span>
          <ArrowToBook className="ml-8" />
        </div>
        <div className="flex items-end gap-6">
          {books.map((book) => (
            <div key={book.id} className="w-32 md:w-36">
              <BookCover
                title={book.title}
                imageUrl={book.imageUrl}
                onClick={() => onOpenBook(book.id)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
