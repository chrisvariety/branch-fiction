import {
  getAttribute,
  parse,
  querySelector,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { Jimp, type loadFont } from 'jimp';

import fontFntText from '../fonts/open-sans-32-black.fnt?raw';
import fontPngUrl from '../fonts/open-sans-32-black.png?url';

type LoadedFont = Awaited<ReturnType<typeof loadFont>>;

let cached: LoadedFont | null = null;

export async function loadBundledFont(): Promise<LoadedFont> {
  if (cached) return cached;

  const font = parseBMFontXML(fontFntText);

  const chars: Record<string, (typeof font.chars)[number]> = {};
  for (const char of font.chars) {
    chars[String.fromCharCode(char.id)] = char;
  }

  const kernings: Record<string, Record<string, number>> = {};
  for (const kerning of font.kernings) {
    const first = String.fromCharCode(kerning.first);
    kernings[first] = kernings[first] || {};
    kernings[first][String.fromCharCode(kerning.second)] = kerning.amount;
  }

  const pngBytes = dataUrlToBytes(fontPngUrl);

  const next = {
    ...font,
    chars,
    kernings,
    pages: [await Jimp.read(pngBytes.slice().buffer)]
  } as unknown as LoadedFont;
  cached = next;
  return next;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) throw new Error('Invalid data URL');
  const bin = atob(dataUrl.slice(commaIdx + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Minimal port of `parse-bmfont-xml` using htmlparser2
interface BMFontChar {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
  page: number;
  chnl: number;
}

interface BMFontKerning {
  first: number;
  second: number;
  amount: number;
}

interface ParsedBMFont {
  pages: string[];
  chars: BMFontChar[];
  kernings: BMFontKerning[];
  info: Record<string, number | number[] | string>;
  common: Record<string, number | number[] | string>;
}

const STRING_ATTRS = new Set(['face', 'charset']);
const LIST_ATTRS = new Set(['padding', 'spacing']);

function parseAttribs(el: ReturnType<typeof querySelector>): Record<string, unknown> {
  if (!el || el.type !== 'tag') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el.attribs ?? {})) {
    const key = k === 'chasrset' ? 'charset' : k; // GlyphDesigner typo
    if (STRING_ATTRS.has(key)) out[key] = v;
    else if (LIST_ATTRS.has(key)) out[key] = v.split(',').map((n) => parseInt(n, 10));
    else out[key] = parseInt(v, 10);
  }
  return out;
}

function parseBMFontXML(text: string): ParsedBMFont {
  const ast = parse(text);

  const info = parseAttribs(querySelector(ast, 'info')) as ParsedBMFont['info'];
  const common = parseAttribs(querySelector(ast, 'common')) as ParsedBMFont['common'];

  const pages: string[] = [];
  for (const pageEl of querySelectorAll(ast, 'pages > page')) {
    const id = parseInt(getAttribute(pageEl, 'id') ?? '0', 10);
    const file = getAttribute(pageEl, 'file') ?? '';
    pages[id] = file;
  }

  const chars: BMFontChar[] = querySelectorAll(ast, 'chars > char').map(
    (el) => parseAttribs(el) as unknown as BMFontChar
  );

  const kernings: BMFontKerning[] = querySelectorAll(ast, 'kernings > kerning').map(
    (el) => parseAttribs(el) as unknown as BMFontKerning
  );

  return { pages, chars, kernings, info, common };
}
