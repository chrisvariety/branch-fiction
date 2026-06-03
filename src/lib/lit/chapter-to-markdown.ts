import { selectAll } from 'css-select';
import render from 'dom-serializer';
import type { ChildNode, Document, Element, Text } from 'domhandler';
import { Element as DomElement, Text as DomText } from 'domhandler';
import { textContent } from 'domutils';
import { parseDocument } from 'htmlparser2';
import type { Blockquote, RootContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import postcss from 'postcss';

const STYLE_TO_TAG = {
  'font-style: italic': 'em',
  'font-weight: bold': 'strong',
  'text-decoration: underline': 'u'
};

export const THEMATIC_BREAK = '----------------';

const FANCY_QUOTE_MAP: Record<string, string> = {
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '‹': '<',
  '›': '>'
};

function normalizeFancyQuotes(s: string): string {
  return s.replace(/[‘-‟‹›]/g, (c) => FANCY_QUOTE_MAP[c] ?? c);
}

function walkSync(node: Document | ChildNode, callback: (node: ChildNode) => void) {
  if ('children' in node && node.children) {
    for (const child of node.children) {
      callback(child);
      walkSync(child, callback);
    }
  }
}

function isElement(node: ChildNode): node is Element {
  return node.type === 'tag';
}

const EMPHASIS_TAGS = new Set(['em', 'strong', 'u', 'i', 'b']);

// fix drop-cap initials authored outside the emphasis, e.g. `"O<em>nce upon a time."</em>`
function foldOrphanedInitials(ast: Document) {
  walkSync(ast, (node) => {
    if (!isElement(node) || !EMPHASIS_TAGS.has(node.name)) return;

    const prev = node.prev;
    if (!prev || prev.type !== 'text' || prev.prev != null) return;

    const data = (prev as Text).data;
    const fragment = data.match(/(\S+)$/)?.[1];
    if (!fragment) return;
    if (data.slice(0, data.length - fragment.length).trim() !== '') return;
    // Only fold if the fragment is a single letter optionally preceded by punctuation,
    // and the emphasis node itself begins with a letter (so the initial merges into a word).
    if (!/^[^\p{L}\p{N}]*\p{L}$/u.test(fragment)) return;
    if (!/^\p{L}/u.test(textContent(node))) return;

    (prev as Text).data = data.slice(0, data.length - fragment.length);
    const first = node.children[0];
    if (first && first.type === 'text') {
      (first as Text).data = fragment + (first as Text).data;
    } else {
      const text = new DomText(fragment);
      text.parent = node;
      node.children.unshift(text);
    }
  });
}

export function preprocessChapterHtml(data: {
  css: { href: string; content: string }[];
  html: string;
}): string {
  const { css, html } = data;

  const classToTag: Record<string, string> = {};
  const centeredClasses = new Set<string>();
  const borderDinkusSelectors: string[] = [];

  for (const cssFile of css) {
    try {
      const cssContent = cssFile.content;
      const root = postcss.parse(cssContent);

      root.walkRules((rule) => {
        const classSelectors: string[] = [];
        const matches = rule.selector.matchAll(/\.([a-zA-Z0-9_-]+)/g);
        for (const match of matches) {
          classSelectors.push(match[1]);
        }

        const declarations: string[] = [];
        rule.walkDecls((decl) => {
          declarations.push(`${decl.prop}: ${decl.value}`);
        });

        const pseudoMatch = rule.selector.match(/^(.+?)::(?:before|after)$/);
        if (pseudoMatch) {
          const hasBorder = declarations.some(
            (d) => d.startsWith('border-top:') || d.startsWith('border-bottom:')
          );
          const hasEmptyContent =
            declarations.includes('content: ""') || declarations.includes("content: ''");
          if (hasBorder && hasEmptyContent) {
            borderDinkusSelectors.push(pseudoMatch[1].trim());
          }
        }

        if (classSelectors.length) {
          if (declarations.includes('text-align: center')) {
            classSelectors.forEach((classSelector) => {
              centeredClasses.add(classSelector);
            });
          }

          for (const [style, tagName] of Object.entries(STYLE_TO_TAG)) {
            if (declarations.includes(style)) {
              classSelectors.forEach((classSelector) => {
                classToTag[classSelector] = tagName;
              });
            }
          }
        }
      });
    } catch (error) {
      console.error(`Error processing CSS file ${cssFile.href}:`, error);
    }
  }

  const ast = parseDocument(html);

  const breakpointChars = ['•', '~', '…', '...'];

  walkSync(ast, (node) => {
    if (!isElement(node)) return;
    const el = node;

    if (el.name === 'p') {
      const hasAlign = el.attribs?.align === 'center';
      const hasClass = el.attribs?.class
        ?.split(' ')
        .some((cls) => centeredClasses.has(cls));

      if (hasAlign || hasClass) {
        const text = textContent(el).trim();

        if (breakpointChars.includes(text)) {
          el.name = 'hr';
          el.children = [];
          el.attribs = {};
        }
      }
    }

    if (el.name === 'span') {
      const classes = el.attribs?.class?.split(' ') || [];
      for (const cls of classes) {
        if (classToTag[cls]) {
          el.name = classToTag[cls];
          delete el.attribs.class;
          break;
        }
      }
    }
  });

  foldOrphanedInitials(ast);

  // Insert <hr> before elements matched by CSS border-based dinkus selectors
  for (const selector of borderDinkusSelectors) {
    try {
      const matched = selectAll(selector, ast);
      for (const el of matched) {
        const parent = el.parent;
        if (!parent || !('children' in parent)) continue;
        const idx = parent.children.indexOf(el as ChildNode);
        if (idx < 0) continue;
        const hr = new DomElement('hr', {}, []);
        hr.parent = parent;
        parent.children.splice(idx, 0, hr);
      }
    } catch {
      // selector may not be parseable by css-select, skip
    }
  }

  return render(ast);
}

export function postprocessMarkdown(markdown: string): string {
  const unwrapped = unwrapFullBlockquotes(markdown);

  return normalizeFancyQuotes(unwrapped).trim();
}

// swap ornamental images that an LLM confirmed are scene-break dinkus(es) with thematic breaks
export function applyImageDinkus(markdown: string, dinkusImageSrcs: string[]): string {
  if (dinkusImageSrcs.length === 0) return markdown;
  const srcs = new Set(dinkusImageSrcs);
  const tree = fromMarkdown(markdown);

  let changed = false;
  tree.children = tree.children.map((node): RootContent => {
    if (
      node.type === 'paragraph' &&
      node.children.length === 1 &&
      node.children[0].type === 'image' &&
      srcs.has(node.children[0].url)
    ) {
      changed = true;
      return { type: 'thematicBreak' };
    }
    return node;
  });

  if (!changed) return markdown;

  return toMarkdown(tree, {
    emphasis: '_',
    rule: THEMATIC_BREAK[0] as '-' | '*' | '_',
    ruleRepetition: THEMATIC_BREAK.length
  }).trim();
}

// sometimes whole books are wrapped in blockquotes, so unwrap them
function unwrapFullBlockquotes(markdown: string): string {
  const tree = fromMarkdown(markdown);

  // Split top-level children into segments divided by thematic breaks
  const segments: RootContent[][] = [[]];
  for (const node of tree.children) {
    if (node.type === 'thematicBreak') {
      segments.push([node]);
      segments.push([]);
    } else {
      segments[segments.length - 1].push(node);
    }
  }

  const newChildren: RootContent[] = [];
  for (const segment of segments) {
    const contentNodes = segment.filter((n) => n.type !== 'thematicBreak');
    const blockquoteNodes = contentNodes.filter(
      (n): n is Blockquote => n.type === 'blockquote'
    );

    // If ≥80% of content nodes are blockquotes, unwrap them
    if (contentNodes.length > 0 && blockquoteNodes.length / contentNodes.length >= 0.8) {
      for (const node of segment) {
        if (node.type === 'blockquote') {
          newChildren.push(...(node.children as RootContent[]));
        } else {
          newChildren.push(node);
        }
      }
    } else {
      newChildren.push(...segment);
    }
  }

  tree.children = newChildren;
  return toMarkdown(tree, {
    emphasis: '_',
    rule: THEMATIC_BREAK[0] as '-' | '*' | '_',
    ruleRepetition: THEMATIC_BREAK.length
  });
}
