import { selectAll, selectOne } from 'css-select';
import render from 'dom-serializer';
import type { AnyNode, Element } from 'domhandler';
import { textContent } from 'domutils';
import { parseDocument } from 'htmlparser2';

export type Node = AnyNode;

export function parse(xml: string): Node {
  return parseDocument(xml, { xmlMode: true });
}

export function querySelector(node: Node, selector: string): Element | null {
  return selectOne(selector, node);
}

export function querySelectorAll(node: Node, selector: string): Element[] {
  return selectAll(selector, node);
}

export function getInnerHtml(node: Node | null): string {
  if (!node) return '';
  const el = node as Element;
  if (!el.children) return '';
  return el.children
    .map((child) => render(child, { xmlMode: true, encodeEntities: false }))
    .join('');
}

export function getText(node: Node | null): string {
  if (!node) return '';
  return textContent(node);
}

export function getAttribute(node: Node | null, name: string): string | undefined {
  if (!node) return undefined;
  const el = node as Element;
  return el.attribs?.[name];
}
