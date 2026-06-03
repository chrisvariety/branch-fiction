import { estimateTokens } from '../llm/estimate-tokens';

interface Book {
  toc?: Toc[];
  metadata: Metadata;
  contents: Record<string, string>;
}

interface Metadata {
  title: string;
  creators?: string[];
  language: string;
  publisher?: string;
  date?: string; // iso
  description?: string;
  rights?: string;
  subjects?: string[];
  identifiers?: string[];
  contributors?: string[];
}

export interface Toc {
  title: string;
  href: string;
}

export type ParsedBook = {
  getToc: () => Toc[];
  getMetadata: () => {
    title: string;
    language: string;
    publisher?: string;
    rights?: string;
  };
  getChapterMarkdown: (href: string) => string;
  getEstimatedTokenCount: () => number;
};

// Chapters are pre-converted to markdown at import time, so `contents` already holds markdown.
export async function parseBook(json: unknown): Promise<ParsedBook> {
  const book = json as Book;
  return {
    getToc: () => {
      return book.toc || [];
    },

    getMetadata: () => {
      return {
        title: book.metadata.title,
        language: book.metadata.language,
        publisher: book.metadata.publisher,
        rights: book.metadata.rights
      };
    },

    getChapterMarkdown: (href: string) => {
      const markdown = book.contents[parseHref(href)];
      if (markdown == null) {
        throw new Error(`Chapter not found: ${href} (parsed: ${parseHref(href)})`);
      }

      return markdown;
    },

    getEstimatedTokenCount: () => {
      const seenFiles = new Set<string>();
      let totalText = '';
      for (const entry of book.toc || []) {
        const fileName = parseHref(entry.href);
        if (seenFiles.has(fileName)) continue;
        seenFiles.add(fileName);
        const markdown = book.contents[fileName];
        if (!markdown) continue;
        totalText += markdown;
      }
      return estimateTokens(totalText);
    }
  };
}

function parseHref(href: string): string {
  const [fileName] = href.split('#');
  return fileName;
}
