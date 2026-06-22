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

// Pinned version; avoid 2.8.3 which breaks Jimp PNG decode (denoland/deno#35185).
const DENO_VERSION = 'v2.8.2';

// Pinned zip SHA-256s from denoland/deno's .sha256sum files; regenerate on version bump.
const DENO_SHA256 = {
  'aarch64-apple-darwin':
    '02e5eb795c9f763772dfd081429cead9029e0a4a6aaff6d4e5f3ed6d2e94d361',
  'x86_64-apple-darwin':
    '77cf27f835f1921e49434449675c57432c6314d54edc725e2474cc825546e206',
  'x86_64-unknown-linux-gnu':
    '184da7a5267ab649bc08821b3bc3ce6805d8e6985fb82707cb8d5e9fd6535362',
  'aarch64-unknown-linux-gnu':
    '48647189aee6454ed9b9852fa700a77f92b39465c04c625901d165bc8e937afc',
  'x86_64-pc-windows-msvc':
    '6fe073b11cabeba2f2726d8a3d1592b198aec5f23dab3473d0dc8d5ec7aee1c9',
  'aarch64-pc-windows-msvc':
    '37c68c1c78042a0775ed6770da09815572f28f0ee59ab018d409908165cae27d'
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
