import { execSync } from 'node:child_process';
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

const url = `https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-${triple}.zip`;
console.log(`[fetch-deno] downloading ${url}`);

const res = await fetch(url);
if (!res.ok) {
  throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
}
const zipPath = resolve(binariesDir, `deno-${triple}.zip`);
writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

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
