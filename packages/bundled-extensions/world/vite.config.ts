import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { branchFictionExtensionDev } from '@branch-fiction/extension-sdk/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const REACTOR_WASM_DIR = path.join(
  realpathSync(path.resolve(import.meta.dirname, 'node_modules/@reactor-team/js-sdk')),
  'dist/wasm'
);

// js-sdk lazy-loads ./wasm/ relative to its chunk via a vite-ignored import, so emit it alongside.
function reactorWasm(): Plugin {
  return {
    name: 'reactor-wasm',
    apply: 'build',
    generateBundle() {
      for (const file of ['reactor_wasm.js', 'reactor_wasm_bg.wasm']) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/wasm/${file}`,
          source: readFileSync(path.join(REACTOR_WASM_DIR, file))
        });
      }
    }
  };
}

// Iframe build only. The worker bundle is built by tsdown
export default defineConfig({
  plugins: [react(), tailwindcss(), branchFictionExtensionDev(), reactorWasm()],
  optimizeDeps: {
    exclude: ['@reactor-team/js-sdk']
  },
  root: 'src',
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src')
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: { index: path.resolve(import.meta.dirname, 'src/index.html') },
      output: {
        entryFileNames: 'assets/[name]-[hash].js'
      }
    }
  }
});
