import { UnrecoverableError } from '@branch-fiction/extension-sdk/worker/error-types';
import { v7 as uuidv7 } from 'uuid';

import { bridgeUpdateBookImport } from '@/lib/bridge';
import { createBookCategories } from '@/lib/db/models/book-category/create-book-category';
import { getBookCategoriesByBookId } from '@/lib/db/models/book-category/get-book-category';
import { getBookImportById } from '@/lib/db/models/book-import/get-book-import';
import { getBookById } from '@/lib/db/models/book/get-book';
import { getNonEmptyChapterParagraphsByBookId } from '@/lib/db/models/chapter-paragraph/get-chapter-paragraph';
import { CATEGORIES } from '@/lib/lit/categories';
import { createWorkflowFunction, type WorkflowContext } from '@/workflow/handler';

export const handler = createWorkflowFunction<
  {
    bookImportId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    bookImport: NonNullable<Awaited<ReturnType<typeof getBookImportById>>>;
  }
>(
  {
    name: ({ book }) => `Extract Broad Categories for ${book.title}`,
    payload: async ({ bookImportId }) => {
      const bookImport = await getBookImportById(bookImportId);
      const book = bookImport?.bookId ? await getBookById(bookImport.bookId) : null;
      if (!book || !bookImport)
        throw new UnrecoverableError('Book or Book Import not found');
      return { book, bookImport };
    },
    onFailure: async (_, error) => {
      console.log('Error occurred during broad category extraction:', error);
      await bridgeUpdateBookImport({
        status: error instanceof UnrecoverableError ? 'failed' : 'pending',
        lastError: error.message,
        incrementErrorCount: true
      });
    }
  },
  async ({ book }, ctx: WorkflowContext) => {
    ctx.log
      .withMetadata({ bookId: book.id, bookTitle: book.title })
      .info('Starting broad category extraction');

    const existingCategories = await getBookCategoriesByBookId(book.id);

    if (existingCategories.length) {
      ctx.log
        .withMetadata({ bookId: book.id, bookTitle: book.title })
        .info('Skipping, Book categories already exist');
      return Response.json({
        bookId: book.id,
        categoryIds: filterBookCategories(existingCategories).map((bc) => bc.id),
        categoryCount: existingCategories.length
      });
    }

    const paragraphs = await getNonEmptyChapterParagraphsByBookId(book.id);
    const fullText = paragraphs.map((p) => p.content).join('\n');

    if (fullText.trim().length === 0) {
      throw new UnrecoverableError('No content found for book');
    }

    const { categories } = await extractBroadCategories(book, fullText);

    const bookCategories = await createBookCategories(
      categories.map((c) => ({
        id: uuidv7(),
        bookId: book.id,
        name: c.name,
        description: c.description,
        type: c.type,
        allowedTypes: c.allowed_types.map((s) => s),
        // exclusion: 'exclusion' in c ? c.exclusion : undefined,
        examples:
          'examples' in c
            ? c.examples.map((e) => ({
                example_description: e.example_description,
                names: e.names.map((n) => n),
                aliases: e.aliases,
                is_named: e.is_named,
                keywords: e.keywords
              }))
            : []
      }))
    );

    return Response.json({
      bookId: book.id,
      categoryIds: filterBookCategories(bookCategories).map((bc) => bc.id),
      categoryCount: categories.length
    });
  }
);

async function extractBroadCategories(_book: { title: string }, _fullText: string) {
  return { categories: CATEGORIES };
}

// characters get processed separately with a different route (& prompt)
function filterBookCategories<T extends { type: string }>(categories: T[]) {
  return categories.filter((category) => category.type !== 'CHARACTER');
}
