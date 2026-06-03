import { resolve } from 'path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Bind to all interfaces in dev so phones / other devices on the LAN can
    // hit the dev URL directly (e.g. for the Open-on-Phone QR).
    // Override with TAURI_DEV_HOST=<ip> when you need a specific interface for
    // mobile builds / HMR.
    host: host || true,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          // 1421 is the embedded axum server's preferred port — pick a different
          // one for the HMR socket so the two don't fight in mobile dev.
          port: 1422
        }
      : undefined,
    // In dev, Vite serves the SPA shell and bundled .html entries. The embedded
    // axum server (`src-tauri/src/http_server.rs`, port 1421) owns
    // /extension-assets, /extension-data, /extension-providers, /extension-sdk.js and
    // /assets — proxy those through so a phone hitting Vite at :1420 reaches
    // the same endpoints the desktop iframe hits at :1421.
    //
    // `xfwd: true` forwards X-Forwarded-Host/Proto so axum's extension-assets CSP
    // builder (extension_assets.rs) sees the phone-facing origin rather than the
    // proxy upstream's localhost:1421.
    proxy: {
      '/extension-assets': { target: 'http://localhost:1421', xfwd: true },
      '/extension-data': { target: 'http://localhost:1421', xfwd: true },
      '/extension-providers': { target: 'http://localhost:1421', xfwd: true },
      '/extension-sdk.js': { target: 'http://localhost:1421', xfwd: true },
      '/assets': { target: 'http://localhost:1421', xfwd: true },
      '/p/': { target: 'http://localhost:1421', xfwd: true }
    },
    // Sandboxed iframes (`sandbox="allow-scripts"`) post as Origin: null. Axum
    // already runs CorsLayer::new().allow_origin(Any) on every response, so let
    // those headers pass through verbatim instead of letting Vite's default
    // dev-server CORS middleware mangle them.
    cors: false,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        settings: resolve(__dirname, 'settings.html'),
        'new-book': resolve(__dirname, 'new-book.html'),
        book: resolve(__dirname, 'book.html'),
        path: resolve(__dirname, 'path.html')
      }
    }
  }
}));
