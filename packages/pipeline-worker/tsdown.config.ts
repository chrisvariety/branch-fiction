import { isBuiltin } from 'node:module';
import { resolve } from 'node:path';

import { defineConfig } from 'tsdown';

const PKG_ROOT = import.meta.dirname;
const REPO_ROOT = resolve(PKG_ROOT, '../..');

export default defineConfig({
  entry: [resolve(PKG_ROOT, 'src/main.ts')],
  outDir: resolve(REPO_ROOT, 'src-tauri/resources'),
  outputOptions: {
    entryFileNames: 'pipeline-worker.bundle.js',
    codeSplitting: false
  },
  format: 'esm',
  platform: 'node',
  target: 'esnext',
  sourcemap: false,
  dts: false,
  clean: ['pipeline-worker.bundle.js'],
  deps: {
    onlyBundle: false,
    alwaysBundle: [/.*/]
  },
  alias: {
    '@/app': resolve(REPO_ROOT, 'src'),
    '@': resolve(PKG_ROOT, 'src')
  },
  plugins: [
    {
      name: 'node-builtin-prefix',
      resolveId(source) {
        if (source.startsWith('node:')) return { id: source, external: true };
        if (isBuiltin(source)) return { id: `node:${source}`, external: true };
        return null;
      }
    }
  ]
});
