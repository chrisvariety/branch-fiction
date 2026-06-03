// Vite plugin that proxies /extension-sdk.js and SDK data routes to the dev runtime's Hono server.

export type BranchFictionExtensionDevOptions = {
  // Defaults to 1422.
  hostPort?: number;
  // Show a striped overlay at the top of the page during `vite dev` so
  // extension authors don't put important UI under the Tauri window drag region.
  // Defaults to true.
  showDragRegionIndicator?: boolean;
};

export function branchFictionExtensionDev(opts: BranchFictionExtensionDevOptions = {}) {
  const hostPort = opts.hostPort ?? 1422;
  const target = `http://localhost:${hostPort}`;
  const showDragRegionIndicator = opts.showDragRegionIndicator ?? true;
  let isServe = false;
  return {
    name: 'branch-fiction-extension-dev',
    configResolved(config: { command: 'serve' | 'build' }) {
      isServe = config.command === 'serve';
    },
    transformIndexHtml() {
      if (!isServe || !showDragRegionIndicator) return;
      return [
        {
          tag: 'style',
          children: `
            .__bf-drag-region-indicator__ {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              height: 24px;
              background: repeating-linear-gradient(
                45deg,
                rgba(0, 0, 0, 0.18),
                rgba(0, 0, 0, 0.18) 8px,
                rgba(0, 0, 0, 0.06) 8px,
                rgba(0, 0, 0, 0.06) 16px
              );
              color: rgba(0, 0, 0, 0.65);
              font: 11px/24px system-ui, -apple-system, sans-serif;
              text-align: center;
              pointer-events: none;
              user-select: none;
              z-index: 2147483647;
            }
          `,
          injectTo: 'head' as const
        },
        {
          tag: 'div',
          attrs: { class: '__bf-drag-region-indicator__' },
          children: 'Reserved for window drag — keep important UI below',
          injectTo: 'body-prepend' as const
        }
      ];
    },
    config() {
      return {
        server: {
          proxy: {
            '/extension-sdk.js': target,
            '/extension-data': target,
            '/extension-providers': target,
            '/__dev__': target
          },
          // Worker sources are owned by tsdown, not vite
          watch: {
            ignored: ['**/src/worker.ts', '**/src/worker/**']
          }
        }
      };
    },
    configureServer(server: {
      middlewares: {
        use: (
          fn: (
            req: {
              url?: string;
              method?: string;
              headers: Record<string, string | string[] | undefined>;
            },
            res: {
              statusCode: number;
              setHeader: (k: string, v: string) => void;
              end: () => void;
            },
            next: () => void
          ) => void
        ) => void;
      };
    }) {
      // Redirect bare Vite URL visits with no/stale token to the setup UI.
      server.middlewares.use((req, res, next) => {
        if (req.method && req.method !== 'GET' && req.method !== 'HEAD') return next();
        const accept = req.headers.accept;
        const acceptStr = Array.isArray(accept) ? accept.join(',') : (accept ?? '');
        if (!acceptStr.includes('text/html')) return next();
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname.startsWith('/__dev__')) return next();
        const redirectToSetup = () => {
          res.statusCode = 302;
          res.setHeader('Location', '/__dev__/setup?auto=1');
          res.end();
        };
        const token = url.searchParams.get('token');
        if (!token) return redirectToSetup();
        fetch(`${target}/extension-data/${encodeURIComponent(token)}/context`)
          .then((r) => {
            if (r.ok) return next();
            redirectToSetup();
          })
          .catch(() => {
            // shrug, we tried
            next();
          });
      });
    }
  };
}
