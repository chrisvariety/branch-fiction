#!/usr/bin/env node
// Sign an extension bundle as first-party, producing `<dir>/extension.sig`.
//
//   node scripts/sign-extension.mjs <extension-dir> [private-key]
//
// The signed payload is a SHA256SUMS-style manifest of every installed file —
// the exact construction mirrored by `extension_signature.rs` in the app. The
// signature itself is an SSHSIG produced by `ssh-keygen -Y sign`, verified at
// install time against the public key baked into the app binary.
//
// Keep the exclusion rules below in sync with `extension_signature.rs` and the
// install copy filter (`copy_dir_filtered`), or the app will compute a
// different digest and reject the signature.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const SIG_NAMESPACE = 'branch-fiction-extension';
const SIG_FILENAME = 'extension.sig';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '__MACOSX']);
const isExcludedFile = (name) =>
  name === SIG_FILENAME || name === '.DS_Store' || name.startsWith('._');

function collect(root, dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const lstat = lstatSync(path);
    if (lstat.isSymbolicLink()) continue;
    if (lstat.isDirectory()) {
      if (!EXCLUDED_DIRS.has(name)) collect(root, path, out);
      continue;
    }
    if (!lstat.isFile() || isExcludedFile(name)) continue;
    const rel = relative(root, path).split(sep).join('/');
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
    out.push({ rel, hash });
  }
}

function digestMessage(dir) {
  const files = [];
  collect(dir, dir, files);
  files.sort((a, b) =>
    Buffer.compare(Buffer.from(a.rel, 'utf8'), Buffer.from(b.rel, 'utf8'))
  );
  return files.map((f) => `${f.hash}  ${f.rel}\n`).join('');
}

function main() {
  const dir = process.argv[2];
  const keyFile = process.argv[3] ?? process.env.EXTENSION_SIGNING_KEY;
  if (!dir || !keyFile) {
    console.error('usage: node scripts/sign-extension.mjs <extension-dir> <private-key>');
    console.error('       (or set EXTENSION_SIGNING_KEY for the key)');
    process.exit(2);
  }
  if (!existsSync(join(dir, 'manifest.json'))) {
    console.error(`no manifest.json found in ${dir} — is this an extension directory?`);
    process.exit(2);
  }

  const message = digestMessage(dir);
  const work = mkdtempSync(join(tmpdir(), 'sign-extension-'));
  try {
    const msgPath = join(work, 'digest');
    writeFileSync(msgPath, message);
    execFileSync(
      'ssh-keygen',
      ['-Y', 'sign', '-f', keyFile, '-n', SIG_NAMESPACE, msgPath],
      { stdio: ['ignore', 'ignore', 'inherit'] }
    );
    const sig = readFileSync(`${msgPath}.sig`);
    writeFileSync(join(dir, SIG_FILENAME), sig);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`wrote ${join(dir, SIG_FILENAME)}`);
}

main();
