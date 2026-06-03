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
const DENO_VERSION = 'v2.8.1';

// Pinned zip SHA-256s from denoland/deno's .sha256sum files; regenerate on version bump.
const DENO_SHA256 = {
  'aarch64-apple-darwin':
    '8154e2de0ee8c1cae31fa88e078724aaef0295fab9fd2ad6f8520389cee908f6',
  'x86_64-apple-darwin':
    '47473845e0522ba11dd279e3dd318e2d84ee200c56b8280594e0ae0b0f827460',
  'x86_64-unknown-linux-gnu':
    '2d7bb6195226ac832e0bf7109a115f0af65ee69ac797a4bbde5b27a06cc242d9',
  'aarch64-unknown-linux-gnu':
    '67e9df91870fd0af700df924173e3009ea7ff6956e2c3c3bb86065d6070d0fd6',
  'x86_64-pc-windows-msvc':
    '5fb5bac71f609fb91ec8960fb290885aadc27eeb22f07a8eca0c3db6be38b11a'
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
