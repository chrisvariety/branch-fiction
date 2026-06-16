import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { resolve } from 'node:path';

// Pin to a known-good version. Bump deliberately and re-test.
const DENO_VERSION = 'v2.8.3';

// Pinned zip SHA-256s from denoland/deno's .sha256sum files; regenerate on version bump.
const DENO_SHA256 = {
  'aarch64-apple-darwin':
    '88b350be928fdba0e5d8142ff7c101a17133426371e3cf5ed0e0f74e62476f6c',
  'x86_64-apple-darwin':
    '4254ec12123cfcf88b87703d7acf092a1ea024bdf9be8dd3cd9d4474761cb74e',
  'x86_64-unknown-linux-gnu':
    '30455b845ffa6082209c3590269c910ad3b7efdf28c9879afd4006c47ae54197',
  'aarch64-unknown-linux-gnu':
    '5acc74a4b1a191a88a9ce0b66cfa7e077b50352c124629d5186c5711df462415',
  'x86_64-pc-windows-msvc':
    '32fb9ce419b4e36bfb56d2d38978266beea4353e43f384a680f9d26bd85b576f'
};

const skipIfExists = process.argv.includes('--skip-if-exists');

const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? detectHost();
const isWindows = triple.includes('windows');
const ext = isWindows ? '.exe' : '';

const binariesDir = resolve('src-tauri/binaries');
const out = resolve(binariesDir, `deno-${triple}${ext}`);

mkdirSync(binariesDir, { recursive: true });

if (skipIfExists && existsSync(out)) {
  console.log(`[fetch-deno] ${out} exists, skipping`);
  process.exit(0);
}

const expectedSha = DENO_SHA256[triple];
if (!expectedSha) {
  throw new Error(`[fetch-deno] no pinned SHA-256 for ${triple}; refusing to fetch`);
}

const url = `https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-${triple}.zip`;
console.log(`[fetch-deno] downloading ${url}`);

const res = await fetch(url);
if (!res.ok) {
  throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
}
const zipBytes = Buffer.from(await res.arrayBuffer());

const actualSha = createHash('sha256').update(zipBytes).digest('hex');
if (actualSha !== expectedSha) {
  throw new Error(
    `[fetch-deno] checksum mismatch for ${triple}\n  expected ${expectedSha}\n  got      ${actualSha}`
  );
}
console.log(`[fetch-deno] checksum ok (${actualSha})`);

const zipPath = resolve(binariesDir, `deno-${triple}.zip`);
writeFileSync(zipPath, zipBytes);

console.log('[fetch-deno] extracting');
if (isWindows) {
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${binariesDir}' -Force"`,
    { stdio: 'inherit' }
  );
} else {
  execSync(`unzip -o "${zipPath}" -d "${binariesDir}"`, { stdio: 'inherit' });
}

const extractedPath = resolve(binariesDir, isWindows ? 'deno.exe' : 'deno');
renameSync(extractedPath, out);
if (!isWindows) chmodSync(out, 0o755);
rmSync(zipPath);

console.log(`[fetch-deno] ready: ${out}`);

function detectHost() {
  const { platform, arch } = process;
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  }
  if (platform === 'win32') {
    return 'x86_64-pc-windows-msvc';
  }
  throw new Error(`unsupported host platform: ${platform}/${arch}`);
}
