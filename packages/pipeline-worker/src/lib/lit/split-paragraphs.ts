import { THEMATIC_BREAK } from '@/app/lib/lit/chapter-to-markdown';

export function splitParagraphsPreservingBlanks(content: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim() === '>') {
      if (current.length > 0) {
        paragraphs.push(current.join(' ').trim());
        current = [];
      }
      paragraphs.push(''); // represent the blank line / dinkus
    } else if (line.trim() === THEMATIC_BREAK) {
      // Thematic break should be its own paragraph
      if (current.length > 0) {
        paragraphs.push(current.join(' ').trim());
        current = [];
      }
      paragraphs.push(line.trim());
    } else {
      current.push(line);
    }
  }

  // Push the final paragraph (if any)
  if (current.length > 0) {
    paragraphs.push(current.join(' ').trim());
  }

  return paragraphs;
}
