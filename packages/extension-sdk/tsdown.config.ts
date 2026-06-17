import { resolve } from 'node:path';

import { defineConfig } from 'tsdown';

const PKG_ROOT = import.meta.dirname;

export default defineConfig({
  entry: {
    index: resolve(PKG_ROOT, 'src/index.ts'),
    manifest: resolve(PKG_ROOT, 'src/manifest.ts'),
    'pi-handle': resolve(PKG_ROOT, 'src/pi-handle.ts'),
    'pi-ai': resolve(PKG_ROOT, 'src/pi-ai/index.ts'),
    'llm/xml': resolve(PKG_ROOT, 'src/llm/xml.ts'),
    'llm/prompt': resolve(PKG_ROOT, 'src/llm/prompt.ts'),
    'media/art-style': resolve(PKG_ROOT, 'src/media/art-style.ts'),
    'media/generate-one-shot-image': resolve(
      PKG_ROOT,
      'src/media/generate-one-shot-image.ts'
    ),
    'media/image-errors': resolve(PKG_ROOT, 'src/media/image-errors.ts'),
    'media/image-models': resolve(PKG_ROOT, 'src/media/image-models.ts'),
    'media/image-retry': resolve(PKG_ROOT, 'src/media/image-retry.ts'),
    'media/image-types': resolve(PKG_ROOT, 'src/media/image-types.ts'),
    'media/transform-url': resolve(PKG_ROOT, 'src/media/transform-url.ts'),
    'media/image-apis/gemini': resolve(PKG_ROOT, 'src/media/image-apis/gemini.ts'),
    'media/image-apis/openai': resolve(PKG_ROOT, 'src/media/image-apis/openai.ts'),
    'models-catalog': resolve(PKG_ROOT, 'src/models-catalog.ts'),
    'sdk-source': resolve(PKG_ROOT, 'src/sdk-source.ts'),
    dev: resolve(PKG_ROOT, 'src/dev/index.ts'),
    'dev-cli': resolve(PKG_ROOT, 'src/dev/cli.ts'),
    vite: resolve(PKG_ROOT, 'src/vite-plugin.ts'),
    'db/types': resolve(PKG_ROOT, 'src/db/types.ts'),
    'db/iframe': resolve(PKG_ROOT, 'src/db/iframe.ts'),
    'db/boolean-plugin': resolve(PKG_ROOT, 'src/db/boolean-plugin.ts'),
    'db/worker': resolve(PKG_ROOT, 'src/db/worker.ts'),
    'db/parse-count': resolve(PKG_ROOT, 'src/db/parse-count.ts'),
    'worker/error-types': resolve(PKG_ROOT, 'src/worker/error-types.ts'),
    'worker/env-soft': resolve(PKG_ROOT, 'src/worker/env-soft.ts')
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
