import { resolve } from 'node:path';

import { defineConfig } from 'tsdown';

const PKG_ROOT = import.meta.dirname;

export default defineConfig({
  entry: {
    index: resolve(PKG_ROOT, 'src/index.ts'),
    manifest: resolve(PKG_ROOT, 'src/manifest.ts'),
    'pi-handle': resolve(PKG_ROOT, 'src/pi-handle.ts'),
    'sdk-source': resolve(PKG_ROOT, 'src/sdk-source.ts'),
    dev: resolve(PKG_ROOT, 'src/dev/index.ts'),
    'dev-cli': resolve(PKG_ROOT, 'src/dev/cli.ts'),
    vite: resolve(PKG_ROOT, 'src/vite-plugin.ts'),
    'db/types': resolve(PKG_ROOT, 'src/db/types.ts'),
    'db/iframe': resolve(PKG_ROOT, 'src/db/iframe.ts'),
    'db/boolean-plugin': resolve(PKG_ROOT, 'src/db/boolean-plugin.ts')
  },
  outDir: resolve(PKG_ROOT, 'dist'),
  format: 'esm',
  // Node-platform: dev/* uses node:fs/node:path. Browser-only entries
  // (sdk-source, manifest types) don't import node-only modules, so they
  // remain usable in any environment after bundling.
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  dts: true,
  clean: true,
  outputOptions: {
    entryFileNames: '[name].js'
  }
});
