import { parseBook } from '@/app/lib/lit';

const [bookPath, href] = Deno.args;
if (!bookPath || !href) {
  console.error(
    'Usage: deno run -A src/scripts/get-chapter-markdown.ts <book.json> <href>'
  );
  Deno.exit(1);
}

const json = JSON.parse(await Deno.readTextFile(bookPath));
const book = await parseBook(json);

console.log(book.getChapterMarkdown(href));
