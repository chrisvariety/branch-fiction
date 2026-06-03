import { describe, expect, test, vi } from 'vitest';

import {
  applyImageDinkus,
  postprocessMarkdown,
  preprocessChapterHtml,
  THEMATIC_BREAK
} from '@/app/lib/lit/chapter-to-markdown';

const css = (content: string) => [{ href: 'style.css', content }];

describe('preprocessChapterHtml', () => {
  test('converts a bold class to a <strong> tag', () => {
    const html = '<p><span class="bold">This is bold.</span></p>';
    expect(
      preprocessChapterHtml({ css: css('.bold { font-weight: bold; }'), html })
    ).toBe('<p><strong>This is bold.</strong></p>');
  });

  test('converts an italic class to an <em> tag', () => {
    const html = '<p><span class="italic">This is italic.</span></p>';
    expect(
      preprocessChapterHtml({ css: css('.italic { font-style: italic; }'), html })
    ).toBe('<p><em>This is italic.</em></p>');
  });

  test('handles multiple class selectors for one rule', () => {
    const html =
      '<p><span class="bold">This is bold.</span> <span class="heavy">This is also bold.</span></p>';
    const out = preprocessChapterHtml({
      css: css('.bold, .heavy { font-weight: bold; }'),
      html
    });
    expect(out).toContain('<strong>This is bold.</strong>');
    expect(out).toContain('<strong>This is also bold.</strong>');
  });

  test('turns a centered breakpoint paragraph into <hr>', () => {
    const html = '<p class="center">...</p>';
    expect(
      preprocessChapterHtml({ css: css('.center { text-align: center; }'), html })
    ).toBe('<hr>');
  });

  test('turns an align="center" breakpoint paragraph into <hr>', () => {
    expect(preprocessChapterHtml({ css: [], html: '<p align="center">...</p>' })).toBe(
      '<hr>'
    );
  });

  test('leaves ornamental images in place (resolved later as image dinkus)', () => {
    const html = '<p class="center"><img src="orn.png" class="ornamental" /></p>';
    const out = preprocessChapterHtml({
      css: css('.center { text-align: center; }'),
      html
    });
    expect(out).toContain('<img src="orn.png"');
    expect(out).not.toContain('<hr>');
  });

  test('does not rename block elements when a class matches a style-to-tag rule', () => {
    const html =
      '<blockquote><p class="fc">First paragraph.</p><p>Second paragraph.</p></blockquote>';
    const out = preprocessChapterHtml({ css: css('.fc { font-weight: bold; }'), html });
    expect(out).toContain('<p class="fc">First paragraph.</p>');
    expect(out).not.toContain('<strong>');
  });

  test('inserts <hr> for a CSS border-top dinkus via ::before', () => {
    const cssContent =
      'blockquote.d + blockquote.d::before { border-top: 1px solid; content: ""; display: block; }';
    const html =
      '<blockquote class="d"><p>First entry.</p></blockquote><blockquote class="d"><p>Second entry.</p></blockquote>';
    expect(preprocessChapterHtml({ css: css(cssContent), html })).toBe(
      '<blockquote class="d"><p>First entry.</p></blockquote><hr><blockquote class="d"><p>Second entry.</p></blockquote>'
    );
  });

  test('folds a drop-cap initial into the following emphasis', () => {
    const html = '<p>“O<span class="italic">nce upon a time.”</span> The tale began.</p>';
    expect(
      preprocessChapterHtml({ css: css('.italic { font-style: italic; }'), html })
    ).toBe('<p><em>&#x201c;Once upon a time.&#x201d;</em> The tale began.</p>');
  });

  test('folds a drop-cap initial with no leading quote', () => {
    const html = '<p>S<em>he ran home.</em></p>';
    expect(preprocessChapterHtml({ css: [], html })).toBe(
      '<p><em>She ran home.</em></p>'
    );
  });

  test('does not fold genuine intraword emphasis', () => {
    const html = '<p>He felt very un<em>comfortable</em> indeed.</p>';
    expect(preprocessChapterHtml({ css: [], html })).toBe(
      '<p>He felt very un<em>comfortable</em> indeed.</p>'
    );
  });

  test('handles css errors gracefully', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = preprocessChapterHtml({
      css: css('.invalid { this is not valid css }'),
      html: '<p>Hello</p>'
    });
    expect(out).toContain('Hello');
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe('postprocessMarkdown', () => {
  test('unwraps a blockquote that wraps the entire scene', () => {
    const markdown =
      '> First paragraph inside blockquote.\n>\n> Second paragraph inside blockquote.\n>\n> Third paragraph inside blockquote.';
    expect(postprocessMarkdown(markdown)).toBe(
      'First paragraph inside blockquote.\n\nSecond paragraph inside blockquote.\n\nThird paragraph inside blockquote.'
    );
  });

  test('preserves a blockquote that is a minority of the scene', () => {
    const markdown =
      'Normal paragraph before.\n\nAnother normal paragraph.\n\nYet another normal paragraph.\n\n> A quoted line.\n\nNormal paragraph after.';
    expect(postprocessMarkdown(markdown)).toContain('> A quoted line.');
  });

  test('normalizes fancy quotes to straight quotes', () => {
    const markdown =
      '“Hello,” she said. ‘It’s a fine day,’ he replied — „und so weiter‟.';
    expect(postprocessMarkdown(markdown)).toBe(
      `"Hello," she said. 'It's a fine day,' he replied — "und so weiter".`
    );
  });

  test('normalizes thematic breaks to the canonical rule', () => {
    expect(postprocessMarkdown('Before.\n\n***\n\nAfter.')).toBe(
      `Before.\n\n${THEMATIC_BREAK}\n\nAfter.`
    );
  });
});

describe('applyImageDinkus', () => {
  test('replaces a confirmed dinkus image with a thematic break', () => {
    const markdown = 'Before.\n\n![](orn.png)\n\nAfter.';
    expect(applyImageDinkus(markdown, ['orn.png'])).toBe(
      `Before.\n\n${THEMATIC_BREAK}\n\nAfter.`
    );
  });

  test('leaves images that are not confirmed dinkus untouched', () => {
    const markdown = '![](other.png)';
    expect(applyImageDinkus(markdown, ['orn.png'])).toBe(markdown);
  });

  test('is a no-op when there are no dinkus sources', () => {
    const markdown = 'Before.\n\n![](orn.png)\n\nAfter.';
    expect(applyImageDinkus(markdown, [])).toBe(markdown);
  });
});
