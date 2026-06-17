This project uses pnpm. There's subpackages in `packages`.

`pnpm run ci` will run lint + format. Please use it after changes, alongside `pnpm run typecheck`.

If you make a change within a package, run e.g. `pnpm --filter pipeline-worker run ci`.

If you make a change within `src-tauri`, run `cd src-tauri && cargo check && cargo clippy --all-targets`.

Use comments sparingly, let the code speak for itself. When using comments, keep them brief and single line.
