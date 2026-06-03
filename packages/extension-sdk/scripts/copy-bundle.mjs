import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const src = resolve(repoRoot, 'src-tauri/resources/extension-host.bundle.js');
const distDir = resolve(here, '..', 'dist');
const dst = resolve(distDir, 'extension-host.bundle.js');

mkdirSync(distDir, { recursive: true });
copyFileSync(src, dst);
console.log(`copied extension-host bundle -> ${dst}`);
