---
name: split-commits
description: Examine the full working-tree diff, group unrelated changes into N focused commits, and commit each group on approval. Use when the branch has multiple mixed/unstaged changes that belong in separate commits, or the user asks to "split", "tidy", or "commit these changes".
---

# Split working-tree changes into focused commits

This branch often accumulates several unrelated edits at once (different packages, a feature plus a drive-by fix, etc.). This skill reads the **entire** working tree, proposes a grouping into N commits, and — after you approve — stages and commits each group.

Messages follow [Conventional Commits](https://www.conventionalcommits.org/).

## When to invoke

- The user runs `/split-commits`, or asks to "commit", "split these changes", or "tidy the branch".

## Workflow

### 1. Read everything

Run these together and read the full output — don't skim:

```bash
git status --porcelain
git diff           # unstaged tracked changes
git diff --cached  # already-staged changes
```

For untracked files, look at the ones that matter:

```bash
git status --porcelain | grep '^??'
```

Read untracked files you intend to commit with the Read tool. Ignore obvious noise (build output, `node_modules`, lockfile churn) unless the user asks.

### 2. Group into commits

Bucket the changes by what they accomplish, not by file location. Signals that two changes belong in **different** commits:

- A feature change vs an unrelated bugfix/typo/formatting fix that rode along.
- A migration + schema change vs UI work.
- Generated/formatting-only churn (e.g. `fmt`) vs real logic.

Aim for the **smallest number of coherent commits**, not maximum granularity. If everything genuinely belongs together, say so and propose a single commit.

### 3. Propose the plan

Show the user a numbered plan before touching anything:

```
1. <subject>
   - path/a.ts, path/b.ts
2. <subject>
   - src-tauri/src/foo.rs
```

Write subjects as Conventional Commits — see the reference below. A body is optional; add one only when the _why_ isn't obvious from the diff.

Ask: "Commit these as N commits? (or adjust the grouping)". Let the user merge/reorder/relabel before proceeding.

### 4. Stage and commit each group, in order

For each approved group, stage only that group's changes, then commit.

**Whole-file groups** (the common case):

```bash
git reset                       # clear the index first, start from a known state
git add path/a.ts path/b.ts
git commit -m "<subject>"
```

**Splitting hunks within one file** (when one file has changes belonging to different commits): interactive `git add -p` is **not available** in this environment. Instead write the wanted hunks to a patch and apply it to the index:

```bash
git diff -- path/mixed.ts > /tmp/full.patch   # then edit down to the desired hunks
git apply --cached /tmp/desired.patch
git commit -m "<subject>"
```

Keep the rest of `path/mixed.ts` unstaged for a later group. If a file is too tangled to split cleanly by patch, tell the user and suggest committing it whole in one group instead of guessing.

Repeat until every approved group is committed.

### 5. Confirm

Run `git status` and `git log --oneline -N` (N = number of commits made) so the user can see the result. Leave anything you deliberately didn't commit unstaged and mention it.

## Conventional Commits format

```
<type>(<scope>)<!?>: <subject>

<body>

<footer>
```

- **type** (required) — one of:
  - `feat` — a new user-facing capability
  - `fix` — a bug fix
  - `refactor` — code change that neither fixes a bug nor adds a feature
  - `perf` — performance improvement
  - `docs` — docs only
  - `test` — tests only
  - `build` — build system, deps, bundling (e.g. Vite, Cargo, pnpm)
  - `ci` — CI config and scripts
  - `style` — formatting only, no logic change (e.g. `fmt`)
  - `chore` — anything else that doesn't fit above
- **scope** (optional) — the area touched, in parens. Prefer this repo's real boundaries: a package name (`pipeline-worker`), `tauri`/`src-tauri`, `db`/`migrations`, or a window/feature (`new-book`, `reader`). Omit if it spans too much.
- **`!`** — append before the colon for a breaking change, e.g. `feat(db)!: …`. (This skill won't hunt for breaking changes; add `!` only when you already know one applies.)
- **subject** — imperative mood ("add", not "added"), lowercase first word, ≤ 72 chars, no trailing period.
- **body** — wrap at ~72 cols; explain _why_, not _what_.

Examples:

```
feat(new-book): add cover-image cropper to import flow
fix(pipeline-worker): guard against empty chapter batches
build(pipeline-worker): bump tsconfig target to es2022
refactor(tauri): extract window builder into helper
style: fmt
```

## Rules

- **Never** use `--no-verify`. If a pre-commit hook fails, surface the error and fix the cause.
- **Never** use `--amend` or force-push unless explicitly asked.
- **Never** commit a group the user hasn't approved, and never silently fold in changes they excluded.
- **Never** add a `Co-Authored-By` trailer unless you actually co-authored the code in this session. This skill only groups and commits pre-existing working-tree changes, so by default it did **not** author them.
- **Always** show the plan before the first commit.
- The Bash tool's shell may be `fish` — avoid heredocs. Use `git commit -m "..."`, or `git commit -F /tmp/msg.txt` for a multi-line message.
