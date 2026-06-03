---
name: add-window
description: Wire a new Tauri webview window into the app (Rust command, capabilities, HTML entry, Vite input, React bootstrap, router, invoke helper).
---

# Add a new Tauri window

This app is multi-window: each window is its own webview with its own HTML entry, React tree, and TanStack Router. Existing windows you can use as examples (non-exhaustive): `main` (`index.html`), `settings`, `new-book`, `book__<id>` (per-book), `path__<extension-id>` (per-extension).

Pick a kebab-case `name` (e.g. `reader`, `library`, `foo-bar`). If the window is per-entity (one window per book/extension/etc.), use a label _prefix_ with `__<safe-id>` suffix and register `name__*` in capabilities.

## Files to touch

### 1. Rust — `src-tauri/src/window_commands.rs`

Add a `_impl` fn + a `#[tauri::command]` wrapper. Reuse `theme_background(dark)`. If the window takes route params, reuse `encode_route_segment`. If per-entity, sanitize the id to ASCII alphanumeric + `_` for the label.

```rust
pub fn open_<name>_window_impl(
    app_handle: &AppHandle,
    /* id_param: &str, */
    dark: bool,
) -> Result<(), String> {
    let label = "<name>"; // or format!("<name>__{safe_id}") for per-entity

    if let Some(existing) = app_handle.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        app_handle
            .emit_to(label, "<name>:navigate", route)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url_path = format!("<name>.html#{route}"); // hash route or "<name>.html"
    let builder = WebviewWindowBuilder::new(app_handle, &label, WebviewUrl::App(url_path.into()))
        .title("<Title>")
        .inner_size(W, H)
        .min_inner_size(MW, MH)
        .center()
        .background_color(theme_background(dark));

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_<name>_window(
    app_handle: AppHandle,
    /* id_param: String, */
    dark: Option<bool>,
) -> Result<(), String> {
    open_<name>_window_impl(&app_handle, /* &id_param, */ dark.unwrap_or(false))
}
```

### 2. Rust — `src-tauri/src/lib.rs`

Two changes:

- Add `open_<name>_window` to the `use window_commands::{...}` import.
- Add `open_<name>_window,` to the `invoke_handler![...]` list.

### 3. Capabilities — `src-tauri/capabilities/default.json`

Append the label (or pattern) to `"windows"`:

```json
"windows": ["main", "secondary", "settings", "new-book", "path__*", "book__*", "<name>"]
```

For per-entity, use `"<name>__*"`.

### 4. HTML entry — `<name>.html` at workspace root

Copy `book.html` (or whichever existing window is closest to yours) verbatim, changing the `<title>` and the module src to `/src/<name>/index.tsx`. The inline theme-bootstrap script must stay — it prevents a light/dark flash before React mounts.

### 5. Vite — `vite.config.ts`

Add to `build.rollupOptions.input`:

```ts
'<name>': resolve(__dirname, '<name>.html')
```

### 6. React entry — `src/<name>/index.tsx`

Mirror `src/book/index.tsx` (or whichever existing window is closest to yours): copy any top-level `await` calls (e.g. `bootstrapHttpPort()`, `loadProviderCatalog()`) and provider wrappers (e.g. `QueryClientProvider`, `ThemeProvider`, `TooltipProvider`, `RouterProvider`) that are present there, adding or removing them to match the needs of your window. Include the `NavigateOnEvent` listener for `<name>:navigate` so re-opens from Rust can switch routes.

### 7. Router — `src/<name>/router.tsx`

Use `createHashHistory()` (the Rust side appends `#<route>` to the HTML path). Root layout includes `<div data-tauri-drag-region className="fixed inset-x-0 top-0 z-50 h-10" />` so the macOS overlay title-bar zone is draggable.

### 8. Invoke helper — `src/<name>/open-<name>.ts`

```ts
import { invoke } from '@tauri-apps/api/core';

export async function open<Name>Window(/* id: string */): Promise<void> {
  await invoke('open_<name>_window', {
    /* id, */
    dark: document.documentElement.classList.contains('dark')
  });
}
```

Callers import this helper rather than calling `invoke` directly.

## Verification

Run from workspace root:

```sh
pnpm run typecheck
pnpm run ci

cd src-tauri && cargo check && cargo clippy --all-targets
```

Then instruct the user to restart `pnpm tauri dev` — **capabilities are compiled at build time**, so a running dev server won't pick up the `default.json` change until you restart.
