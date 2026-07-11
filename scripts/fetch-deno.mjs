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

const DENO_VERSION = 'v2.9.2';

// Pinned zip SHA-256s from denoland/deno's .sha256sum files; regenerate on version bump.
const DENO_SHA256 = {
  'aarch64-apple-darwin':
    '687ae485168ba73a4f1ee3a954eb4f077eca82f2fefd236a6a83a3889287876c',
  'x86_64-apple-darwin':
    'c953379e5a85a0a30e99aa51b807633e380e809a1181f53e4904d5fa73785bff',
  'x86_64-unknown-linux-gnu':
    '934d1bd5cb09eaed7f2e4a4fc58208d04a3c5c0fcde9f319d93d735265c67a4a',
  'aarch64-unknown-linux-gnu':
    '310b8f48e59964ff18890d35e64f64fb90e8b1cc5d9ebff8c818327d5afb16d2',
  'x86_64-pc-windows-msvc':
    '5fe194d26ac5ef77fcc5288c2c438c7a0465f3b6180440ebf04092714bf2dcdf',
  'aarch64-pc-windows-msvc':
    '28b57dc03be79ec312ee7baf30678865d84c7cb3764ac7da36e242abea6b3b1d'
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
    return arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  }
  throw new Error(`unsupported host platform: ${platform}/${arch}`);
}
