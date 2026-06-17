# @branch-fiction/extension-sdk

SDK and dev tooling for building [Branch Fiction](https://github.com/chrisvariety/branch-fiction) extensions.

## Install

```sh
pnpm add -D @branch-fiction/extension-sdk
```

## Runtime & tooling

- **Iframe SDK**: `window.extensionSDK` (db, fs, worker, providers, context) served to your extension UI.
- **Worker host**: the bundled runtime that boots your `worker` entry in a sandboxed Deno sidecar (`globalThis.host`).
- **Dev CLI**: `branch-fiction-extension-dev`, run it via a `dev` script to develop an extension against a local Branch Fiction install.

## Exports

Shared building blocks for extensions, importable per sub-path so you only pull what you use.

| Import                                                                          | What it gives you                                                                                                |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@branch-fiction/extension-sdk`                                                 | Core SDK types (`ExtensionCtx`, `ExtensionHost`, …).                                                             |
| `…/manifest`                                                                    | `defineManifest`, `validateManifest`, `ExtensionManifestV1`.                                                     |
| `…/pi-ai`                                                                       | pi-ai agent helpers (`completeOrThrow`, `watchAgent`, `watchLoopDetection`) plus the `pi-handle` model builders. |
| `…/pi-handle`, `…/models-catalog`                                               | Build pi-ai `Model` handles from provider bindings; runtime model catalog.                                       |
| `…/llm/xml`, `…/llm/prompt`                                                     | Parse XML LLM output; `createPrompt` (Jinja + valibot) templating.                                               |
| `…/media/*`                                                                     | Image generation: `generate-one-shot-image`, `image-models`, `transform-url`, `image-apis/{gemini,openai}`, etc. |
| `…/db`, `…/db/iframe`, `…/db/worker`, `…/db/boolean-plugin`, `…/db/parse-count` | Kysely schema types, iframe/worker SQLite dialects, helpers.                                                     |
| `…/worker/error-types`, `…/worker/env-soft`                                     | `RecoverableError`/`UnrecoverableError`; Deno env shim for worker entries.                                       |
| `…/vite`, `…/dev`                                                               | Vite dev plugin and the dev-server runtime.                                                                      |

See the [extension guide](https://github.com/chrisvariety/branch-fiction) for the full manifest schema and runtime API.
