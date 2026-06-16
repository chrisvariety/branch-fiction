import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'tsdown';

const PKG_ROOT = import.meta.dirname;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
};

function importerToDir(importer: string | undefined): string | null {
  if (!importer) return null;
  return importer.startsWith('file://')
    ? dirname(fileURLToPath(importer))
    : dirname(importer);
}

export default defineConfig({
  entry: [resolve(PKG_ROOT, 'src/worker.ts')],
  outDir: resolve(PKG_ROOT, 'dist'),
  outputOptions: {
    entryFileNames: 'worker.js',
    codeSplitting: false
  },
  format: 'esm',
  platform: 'node',
  target: 'esnext',
  sourcemap: false,
  dts: false,
  clean: ['worker.js'],
  deps: {
    onlyBundle: false,
    alwaysBundle: [/.*/]
  },
  plugins: [
    // Rewrite bare node-builtin imports to `node:` form and externalize.
    // Without this, pngjs's chunkstream / sync-inflate (`require('util')`,
    // `require('zlib')`, etc.) end up unresolved or stubbed.
    {
      name: 'node-builtin-prefix',
      resolveId(source) {
        if (source.startsWith('node:')) return { id: source, external: true };
        if (isBuiltin(source)) return { id: `node:${source}`, external: true };
        return null;
      }
    },
    // Vite-style `?raw` / `?url` asset imports. Used by `lib/font.ts` to
    // inline the bundled bitmap font (.fnt as text, .png as a data URL).
    {
      name: 'asset-import-suffix',
      resolveId(source, importer) {
        const m = /^(.+)\?(raw|url)$/.exec(source);
        if (!m) return null;
        const [, base, query] = m;
        const dir = importerToDir(importer);
        if (!dir) return null;
        return { id: `\0asset:${query}:${resolve(dir, base)}` };
      },
      load(id) {
        // oxlint-disable-next-line no-control-regex
        const m = /^\0asset:(raw|url):(.+)$/.exec(id);
        if (!m) return null;
        const [, query, file] = m;
        if (query === 'raw') {
          return `export default ${JSON.stringify(readFileSync(file, 'utf8'))};`;
        }
        const ext = extname(file).slice(1).toLowerCase();
        const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
        const b64 = readFileSync(file).toString('base64');
        return `export default ${JSON.stringify(`data:${mime};base64,${b64}`)};`;
      }
    }
  ]
});
