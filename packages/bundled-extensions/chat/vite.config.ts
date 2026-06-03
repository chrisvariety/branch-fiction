import path from 'node:path';

import { branchFictionExtensionDev } from '@branch-fiction/extension-sdk/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Iframe build only. The worker bundle is built by tsdown
export default defineConfig({
  plugins: [react(), tailwindcss(), branchFictionExtensionDev()],
  root: 'src',
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: { index: path.resolve(__dirname, 'src/index.html') },
      output: {
        entryFileNames: 'assets/[name]-[hash].js'
      }
    }
  }
});
