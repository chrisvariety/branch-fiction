import { describe, expect, test } from 'vitest';

import { THEMATIC_BREAK } from '@/app/lib/lit/chapter-to-markdown';

import { splitParagraphsPreservingBlanks } from '../split-paragraphs';

describe('splitParagraphsPreservingBlanks', () => {
  test('should split paragraphs on blank lines', () => {
    const content = 'First paragraph.\n\nSecond paragraph.';
    const result = splitParagraphsPreservingBlanks(content);
    expect(result).toEqual(['First paragraph.', '', 'Second paragraph.']);
  });

  test('should join consecutive lines into single paragraph', () => {
    const content = 'Line one.\nLine two.\nLine three.';
    const result = splitParagraphsPreservingBlanks(content);
    expect(result).toEqual(['Line one. Line two. Line three.']);
  });

  test('should treat thematic break as its own paragraph', () => {
    const content = `The dog ran across the yard.\n${THEMATIC_BREAK}\nThen it jumped over the fence.`;
    const result = splitParagraphsPreservingBlanks(content);
    expect(result).toEqual([
      'The dog ran across the yard.',
      THEMATIC_BREAK,
      'Then it jumped over the fence.'
    ]);
  });

  test('should handle thematic break with blank lines', () => {
    const content = `First paragraph.\n\n${THEMATIC_BREAK}\n\nSecond paragraph.`;
    const result = splitParagraphsPreservingBlanks(content);
    expect(result).toEqual([
      'First paragraph.',
      '',
      THEMATIC_BREAK,
      '',
      'Second paragraph.'
    ]);
  });

  test('should handle thematic break at end of content', () => {
    const content = `Some text here.\n${THEMATIC_BREAK}`;
    const result = splitParagraphsPreservingBlanks(content);
    expect(result).toEqual(['Some text here.', THEMATIC_BREAK]);
  });

  test('should split blockquote paragraphs on blank blockquote lines', () => {
    const content = '> First paragraph.\n>\n> Second paragraph.\n>\n> Third paragraph.';
    const result = splitParagraphsPreservingBlanks(content);
    expect(result).toEqual([
      '> First paragraph.',
      '',
      '> Second paragraph.',
      '',
      '> Third paragraph.'
    ]);
  });
});
