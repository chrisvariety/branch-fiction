import { encode as base64Encode } from '@stablelib/base64';

import * as xml from './llm/xml';

export type EpubEntries = Map<string, Uint8Array>;

const TEXT_DECODER = new TextDecoder('utf-8');

function decodeUtf8(entry: Uint8Array | undefined): string | null {
  return entry ? TEXT_DECODER.decode(entry) : null;
}

export function isLcpProtected(entries: EpubEntries): boolean {
  if (entries.has('META-INF/license.lcpl') || entries.has('license.lcpl')) return true;
  const encryptionXml = decodeUtf8(entries.get('META-INF/encryption.xml'));
  return !!encryptionXml && encryptionXml.includes('readium.org/2014/01/lcp');
}

interface NavPoint {
  title: string;
  href: string;
  children: NavPoint[];
}

function getFirst(obj: Record<string, string[]>, key: string) {
  return obj[key] && obj[key].length > 0 ? obj[key][0] : null;
}

function getAll(obj: Record<string, string[]>, key: string) {
  return obj[key] || [];
}

function flattenToc(
  toc: NavPoint[]
): { title: string; href: string; isParent: boolean }[] {
  const result: { title: string; href: string; isParent: boolean }[] = [];
  for (const item of toc) {
    const isParent = item.children && item.children.length > 0;
    result.push({
      title: item.title,
      href: item.href.split('#')[0],
      isParent
    });
    if (isParent) {
      result.push(...flattenToc(item.children));
    }
  }
  return result;
}

function preserveTocHierarchy(toc: NavPoint[]): any[] {
  const result: any[] = [];
  for (const item of toc) {
    if (item.children && item.children.length > 0) {
      result.push({
        type: 'section',
        title: item.title,
        href: item.href.split('#')[0],
        children: preserveTocHierarchy(item.children)
      });
    } else {
      result.push({
        type: 'link',
        title: item.title,
        href: item.href.split('#')[0]
      });
    }
  }
  return result;
}

export function parseEpub(entries: EpubEntries) {
  // 1. Find OPF
  const containerText = decodeUtf8(entries.get('META-INF/container.xml'));
  if (!containerText) throw new Error('Invalid EPUB: META-INF/container.xml not found');
  const containerDoc = xml.parse(containerText);
  const rootfileEl = xml.querySelector(containerDoc, 'rootfile');
  const opfPath = xml.getAttribute(rootfileEl, 'full-path');
  if (!opfPath) throw new Error('Invalid EPUB: OPF path not found');

  const opfText = decodeUtf8(entries.get(opfPath));
  if (!opfText) throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}`);
  const opfDoc = xml.parse(opfText);
  const opfDir = opfPath.includes('/')
    ? opfPath.substring(0, opfPath.lastIndexOf('/'))
    : '';

  const resolvePath = (href: string) => (opfDir ? `${opfDir}/${href}` : href);

  // 2. Extract raw Metadata
  const rawMeta: Record<string, string[]> = {};
  const metadataEl = xml.querySelector(opfDoc, 'metadata');
  let coverId: string | null = null;

  if (metadataEl) {
    const metaNodes = xml.querySelectorAll(metadataEl, '*');
    for (const node of metaNodes) {
      const name = (node as any).name;
      if (name) {
        const key = name.replace(/^dc:/, '');
        const val = xml.getText(node).trim();
        if (name === 'meta' && xml.getAttribute(node, 'name') === 'cover') {
          coverId = xml.getAttribute(node, 'content') || null;
        } else if (val) {
          rawMeta[key] = rawMeta[key] || [];
          rawMeta[key].push(val);
        }
      }
    }
  }

  const metadata = {
    title: getFirst(rawMeta, 'title'),
    creators: getAll(rawMeta, 'creator'),
    language: getFirst(rawMeta, 'language'),
    publisher: getFirst(rawMeta, 'publisher'),
    date: getFirst(rawMeta, 'date'),
    description: getFirst(rawMeta, 'description'),
    rights: getFirst(rawMeta, 'rights'),
    subjects: getAll(rawMeta, 'subject'),
    identifiers: getAll(rawMeta, 'identifier'),
    contributors: getAll(rawMeta, 'contributor')
  };
  for (const k of Object.keys(metadata)) {
    const val = (metadata as any)[k];
    if (
      val === null ||
      val === undefined ||
      val === '' ||
      (Array.isArray(val) && val.length === 0)
    ) {
      delete (metadata as any)[k];
    }
  }

  // 3. Extract Manifest
  const manifestItems = xml.querySelectorAll(opfDoc, 'manifest item');
  const manifest = new Map<string, any>();
  const stylesheets: { href: string; content: string }[] = [];
  let ncxHref: string | null = null;
  let coverEntryItem: any = null;

  for (const item of manifestItems) {
    const id = xml.getAttribute(item, 'id')!;
    const href = xml.getAttribute(item, 'href')!;
    const mediaType = xml.getAttribute(item, 'media-type')!;
    const properties = xml.getAttribute(item, 'properties') || '';

    manifest.set(id, { id, href, mediaType });

    if (mediaType === 'text/css') {
      const cssText = decodeUtf8(entries.get(resolvePath(href)));
      if (cssText !== null) {
        stylesheets.push({ href, content: cssText });
      }
    }

    if (mediaType === 'application/x-dtbncx+xml') {
      ncxHref = href;
    }

    if (id === coverId || properties.includes('cover-image')) {
      coverEntryItem = { id, href, mediaType };
    }
  }

  // 4. Extract Cover
  let cover = null;
  if (coverEntryItem) {
    const cBytes = entries.get(resolvePath(coverEntryItem.href));
    if (cBytes) {
      cover = {
        media_type: coverEntryItem.mediaType,
        data: base64Encode(cBytes)
      };
    }
  }

  // 5. Extract Spine
  const spineItems = xml.querySelectorAll(opfDoc, 'spine itemref');
  const spineHrefs: string[] = [];
  for (const itemref of spineItems) {
    const idref = xml.getAttribute(itemref, 'idref');
    if (idref && manifest.has(idref)) {
      spineHrefs.push(manifest.get(idref)!.href);
    }
  }

  function findNode(node: any, name: string): any {
    if (node.name === name) return node;
    if (node.children) {
      for (const c of node.children) {
        const found = findNode(c, name);
        if (found) return found;
      }
    }
    return null;
  }

  // 6. Parse TOC
  let rawToc: NavPoint[] = [];
  if (ncxHref) {
    const ncxText = decodeUtf8(entries.get(resolvePath(ncxHref)));
    if (ncxText) {
      const ncxDoc = xml.parse(ncxText);
      const navMap = findNode(ncxDoc, 'navMap');

      const parseNavPoint = (np: any): NavPoint | null => {
        const navLabel = findNode(np, 'navLabel');
        const textNode = navLabel ? findNode(navLabel, 'text') : null;
        const contentNode = findNode(np, 'content');
        if (!textNode || !contentNode) return null;

        const title = xml.getText(textNode).trim();
        const src = xml.getAttribute(contentNode, 'src');
        if (!src) return null;

        const children: NavPoint[] = [];
        // Only get direct child navPoints
        if (np.children) {
          for (const child of np.children) {
            if ((child as any).name === 'navPoint') {
              const parsed = parseNavPoint(child);
              if (parsed) children.push(parsed);
            }
          }
        }

        return { title, href: src, children };
      };

      if (navMap && navMap.children) {
        for (const child of navMap.children) {
          if ((child as any).name === 'navPoint') {
            const parsed = parseNavPoint(child);
            if (parsed) rawToc.push(parsed);
          }
        }
      }
    }
  }

  const sections = preserveTocHierarchy(rawToc);
  const tocFlat = flattenToc(rawToc);

  // 7. Expand TOC with Spine (combine split chapters)
  const expandedToc: any[] = [];
  for (let i = 0; i < tocFlat.length; i++) {
    const tocItem = tocFlat[i];
    const startIdx = spineHrefs.indexOf(tocItem.href);

    if (startIdx === -1) {
      expandedToc.push({
        title: tocItem.title,
        hrefs: [tocItem.href],
        isParent: tocItem.isParent
      });
      continue;
    }

    let endIdx = spineHrefs.length;
    if (i + 1 < tocFlat.length) {
      const nextIdx = spineHrefs.indexOf(tocFlat[i + 1].href);
      if (nextIdx !== -1) {
        endIdx = nextIdx;
      }
    }

    expandedToc.push({
      title: tocItem.title,
      hrefs: spineHrefs.slice(startIdx, endIdx),
      isParent: tocItem.isParent
    });
  }

  // Merge 'isParent' items into the next chapter if possible
  const mergedToc: any[] = [];
  for (let i = 0; i < expandedToc.length; i++) {
    if (expandedToc[i].isParent && i + 1 < expandedToc.length) {
      // Merge its hrefs into the next chapter's front
      expandedToc[i + 1].hrefs.unshift(...expandedToc[i].hrefs);
    } else {
      mergedToc.push(expandedToc[i]);
    }
  }

  const toc = mergedToc
    .filter((t) => t.hrefs.length > 0)
    .map((t) => ({
      title: t.title,
      href: t.hrefs[0]
    }));

  const hrefToAllHrefs = new Map<string, string[]>();
  for (const item of mergedToc) {
    if (item.hrefs.length > 0) {
      hrefToAllHrefs.set(item.hrefs[0], item.hrefs);
    }
  }

  // 8. Extract & Combine Contents
  const fileContents = new Map<string, any>();
  for (const href of spineHrefs) {
    const htmlStr = decodeUtf8(entries.get(resolvePath(href)));
    if (htmlStr !== null) {
      fileContents.set(href, xml.parse(htmlStr));
    }
  }

  const contents: Record<string, string | null> = {};
  const seenHrefs = new Set<string>();

  for (const [primaryHref, allHrefs] of hrefToAllHrefs.entries()) {
    for (const href of allHrefs) {
      seenHrefs.add(href);
    }
    if (allHrefs.length === 1) {
      const doc = fileContents.get(primaryHref);
      if (doc) {
        contents[primaryHref] = xml.getInnerHtml(xml.querySelector(doc, 'body') || doc);
      } else {
        contents[primaryHref] = null;
      }
    } else {
      let combinedHtml = '';
      for (const href of allHrefs) {
        const doc = fileContents.get(href);
        if (doc) {
          const body = xml.querySelector(doc, 'body');
          combinedHtml += xml.getInnerHtml(body || doc);
        }
      }
      contents[primaryHref] = combinedHtml || null;
    }
  }

  // Add any missing files not in TOC
  for (const href of spineHrefs) {
    if (!seenHrefs.has(href)) {
      const doc = fileContents.get(href);
      if (doc) {
        contents[href] = xml.getInnerHtml(xml.querySelector(doc, 'body') || doc);
      } else {
        contents[href] = null;
      }
    }
  }

  return {
    toc,
    sections,
    metadata,
    contents,
    stylesheets,
    cover
  };
}
