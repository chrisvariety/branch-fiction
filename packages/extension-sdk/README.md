# @branch-fiction/extension-sdk

SDK and dev tooling for building [Branch Fiction](https://github.com/chrisvariety/branch-fiction) extensions.

## Install

```sh
pnpm add -D @branch-fiction/extension-sdk
```

## What's included

- **Iframe SDK** — `window.extensionSDK` (db, fs, worker, providers, context) served to your extension UI.
- **Worker host** — the bundled runtime that boots your `worker` entry in a sandboxed Deno sidecar (`globalThis.host`).
- **Manifest helpers** — `defineManifest`, `validateManifest`, and the `ExtensionManifestV1` types.
- **Dev CLI** — `branch-fiction-extension-dev`, run it via a `dev` script to develop an extension against a local Branch Fiction install.

See the [extension guide](https://github.com/chrisvariety/branch-fiction) for the full manifest schema and runtime API.
