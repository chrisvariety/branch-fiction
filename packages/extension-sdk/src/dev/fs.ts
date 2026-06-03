import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';

export function safeJoin(root: string, rel: string): string {
  if (rel.startsWith('/') || isAbsolute(rel)) {
    throw new Error(`absolute path not allowed: ${rel}`);
  }
  const joined = normalize(join(root, rel));
  const inside = relative(root, joined);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(`path escapes assets dir: ${rel}`);
  }
  return joined;
}

export function fsRead(assetsDir: string, relPath: string): { bytesBase64: string } {
  const path = safeJoin(assetsDir, relPath);
  const bytes = readFileSync(path);
  return { bytesBase64: bytes.toString('base64') };
}

export function fsWrite(
  assetsDir: string,
  relPath: string,
  bytesBase64: string
): { ok: true } {
  const path = safeJoin(assetsDir, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(bytesBase64, 'base64'));
  return { ok: true };
}

export function fsList(
  assetsDir: string,
  relPath: string | null
): { name: string; isDirectory: boolean }[] {
  const path = safeJoin(assetsDir, relPath ?? '');
  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch {
    return [];
  }
  return entries.map((name) => {
    let isDirectory = false;
    try {
      isDirectory = statSync(join(path, name)).isDirectory();
    } catch {
      // ignore
    }
    return { name, isDirectory };
  });
}
