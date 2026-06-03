import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

let dataRoot: string | null = null;

export function setDataRoot(root: string): void {
  dataRoot = root;
}

function resolveExtensionPath(rel: string): string {
  if (!dataRoot) throw new Error('extension data root not initialized');
  if (typeof rel !== 'string') throw new Error('fs: relPath must be a string');
  if (rel.includes('..') || rel.startsWith('/')) {
    throw new Error('Invalid path');
  }
  const full = resolve(dataRoot, rel);
  if (!full.startsWith(dataRoot + sep) && full !== dataRoot) {
    throw new Error('Path escapes extension data directory');
  }
  return full;
}

export async function read(rel: string): Promise<Uint8Array> {
  const full = resolveExtensionPath(rel);
  const buf = await readFile(full);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export async function write(rel: string, bytes: Uint8Array): Promise<void> {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('fs.write: bytes must be a Uint8Array');
  }
  const full = resolveExtensionPath(rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

export type FsListEntry = { name: string; isDirectory: boolean };

export async function list(rel = ''): Promise<FsListEntry[]> {
  const full = resolveExtensionPath(rel);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) {
    throw new Error('fs.list: target is not a directory');
  }
  const entries = await readdir(full, { withFileTypes: true });
  return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
}
