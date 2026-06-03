import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const PKG_ROOT = import.meta.dirname;
const REPO_ROOT = resolve(PKG_ROOT, '../..');

export default defineConfig({
  resolve: {
    alias: {
      '@/app': resolve(REPO_ROOT, 'src'),
      '@': resolve(PKG_ROOT, 'src')
    }
  }
});
