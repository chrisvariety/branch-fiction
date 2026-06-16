import { BookInteractive } from '@/lib/db/types';
import { UnrecoverableError } from '@/lib/error-types';
import { getDb } from '@/worker/db';
import { getBookInteractiveByIdSlim } from '@/worker/db/models/book-interactive/get-book-interactive';
import { promoteBookInteractive } from '@/worker/db/models/book-interactive/update-book-interactive';
import { getBookById } from '@/worker/db/models/book/get-book';
import { addOrdinalSuffix, createWorkflowFunction } from '@/worker/handler';

export const handler = createWorkflowFunction<
  {
    bookId: string;
    interactiveId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    interactive: {
      id: string;
      type: BookInteractive['type'];
      url: string | null;
    };
  },
  { success: boolean; interactiveId: string }
>(
  {
    name: ({ book }, retryCount) =>
      `Finalize Place Interactive ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId, interactiveId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      // Get the interactive
      const interactive = await getBookInteractiveByIdSlim(interactiveId);

      if (!interactive) {
        throw new UnrecoverableError('Interactive not found');
      }

      return { book, interactive };
    },
    check: async (_payload, result) => ({
      passed: result.success,
      metadata: { interactiveId: result.interactiveId }
    })
  },
  async ({ book, interactive }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title,
        interactiveId: interactive.id,
        interactiveType: interactive.type
      })
      .info('Finalizing place interactive');

    // Promote this interactive to active (archives the previous active one)
    await getDb()
      .transaction()
      .execute(async (trx) => {
        await promoteBookInteractive(book.id, interactive.type, interactive.id, trx);
      });

    ctx.log
      .withMetadata({
        bookId: book.id,
        interactiveId: interactive.id
      })
      .info('Successfully finalized place interactive');

    return {
      success: true,
      interactiveId: interactive.id
    };
  }
);
