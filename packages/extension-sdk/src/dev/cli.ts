#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';

import { validateManifest } from '../manifest';
import { type Bridge, createBridge, UnpairedError } from './bridge-client';
import { readDevConfig, writeDevConfig } from './config';
import { createDevServer } from './server';

type CliArgs = {
  extensionDir: string;
  vitePort: number;
  hostPort: number;
  bridgePort?: number;
};

function parseArgs(argv: string[]): CliArgs {
  let extensionDir = process.cwd();
  let vitePort = 5173;
  let hostPort = 1422;
  let bridgePort: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') {
      extensionDir = resolve(argv[++i] ?? '');
    } else if (arg === '--vite-port') {
      vitePort = Number(argv[++i]);
    } else if (arg === '--host-port') {
      hostPort = Number(argv[++i]);
    } else if (arg === '--bridge-port') {
      bridgePort = Number(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return { extensionDir, vitePort, hostPort, bridgePort };
}

function printHelp() {
  console.log(
    `Usage: branch-fiction-extension-dev [--dir <extension source dir>] [--vite-port <n>] [--host-port <n>] [--bridge-port <n>]\n\nSpawns Vite (UI HMR), tsdown --watch (worker rebuild), and a local\ndev server. Open the printed URL in your browser to iterate.\n\nRequires the Branch Fiction app to be running for extension DB prep + book seeding.`
  );
}

function hasFile(dir: string, basename: string): boolean {
  for (const ext of ['.ts', '.js', '.mjs', '.cjs']) {
    if (existsSync(resolve(dir, basename + ext))) return true;
  }
  return false;
}

function writeGeneratedViteConfig(
  extensionDir: string,
  root: string,
  hostPort: number
): string {
  const cacheDir = resolve(
    extensionDir,
    'node_modules/.cache/branch-fiction-extension-dev'
  );
  mkdirSync(cacheDir, { recursive: true });
  const path = resolve(cacheDir, 'vite.config.mjs');
  const body = `import { branchFictionExtensionDev } from '@branch-fiction/extension-sdk/vite';
export default {
  root: ${JSON.stringify(resolve(extensionDir, root))},
  plugins: [branchFictionExtensionDev({ hostPort: ${hostPort} })]
};
`;
  writeFileSync(path, body);
  return path;
}

function denoTripleSuffix(): string | null {
  const ext = process.platform === 'win32' ? '.exe' : '';
  if (process.platform === 'darwin' && process.arch === 'arm64')
    return `aarch64-apple-darwin${ext}`;
  if (process.platform === 'darwin' && process.arch === 'x64')
    return `x86_64-apple-darwin${ext}`;
  if (process.platform === 'linux' && process.arch === 'x64')
    return `x86_64-unknown-linux-gnu${ext}`;
  if (process.platform === 'win32' && process.arch === 'x64')
    return 'x86_64-pc-windows-msvc.exe';
  return null;
}

function locateDeno(bridgeDeno?: string): string {
  if (bridgeDeno && existsSync(bridgeDeno)) return bridgeDeno;
  const here = dirname(fileURLToPath(import.meta.url));
  const triple = denoTripleSuffix();
  if (triple) {
    const candidates = [
      resolve(here, `deno-${triple}`),
      resolve(here, '..', '..', '..', '..', 'src-tauri', 'binaries', `deno-${triple}`)
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }
  const onPath = spawnSync('deno', ['--version'], { stdio: 'ignore' });
  if (onPath.status === 0) {
    console.warn(
      `[dev] Branch Fiction app didn't report a bundled deno — falling back to \`deno\` on PATH. Update the app to a newer version to use the bundled sidecar.`
    );
    return 'deno';
  }
  throw new Error(
    `No deno binary found. The Branch Fiction app should ship one as a sidecar — make sure you're running an up-to-date app, or install Deno (https://deno.land) yourself.`
  );
}

function locateExtensionHostBundle(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const sibling = resolve(here, 'extension-host.bundle.js');
  if (existsSync(sibling)) return sibling;
  const workspaceCandidate = resolve(
    here,
    '..',
    '..',
    '..',
    '..',
    'src-tauri',
    'resources',
    'extension-host.bundle.js'
  );
  if (existsSync(workspaceCandidate)) return workspaceCandidate;
  throw new Error(
    `extension-host.bundle.js not found — did \`pnpm vendor:bundle\` run during extension-sdk build?`
  );
}

async function ensurePairedAndPrepare(
  bridge: Bridge,
  configPath: string,
  extensionId: string
): Promise<{
  dbPath: string;
  dataDir: string;
  assetsDir: string;
  denoBin?: string;
}> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const config = readDevConfig(configPath);
    if (config.bridgeToken) bridge.setToken(config.bridgeToken);

    if (!config.bridgeToken) {
      const code = await promptPairingCode();
      const token = await bridge.pair(extensionId, code);
      writeDevConfig(configPath, { ...config, bridgeToken: token });
      console.log(`[dev] paired — token saved to ${configPath}`);
    }

    try {
      return await bridge.prepareDb(extensionId);
    } catch (e) {
      if (e instanceof UnpairedError) {
        console.warn('[dev] pairing token rejected — re-pairing');
        const fresh = readDevConfig(configPath);
        delete fresh.bridgeToken;
        writeDevConfig(configPath, fresh);
        bridge.setToken(undefined);
        continue;
      }
      throw e;
    }
  }
  throw new Error('failed to prepare extension DB after re-pair');
}

async function promptPairingCode(): Promise<string> {
  console.log(
    '\n[dev] No pairing yet. In the Branch Fiction app: Settings → Extensions → Enable extension dev mode → Pair new dev client.'
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await rl.question('[dev] Enter the pairing code: ')).trim();
      if (/^[0-9a-f]{32}$/i.test(answer)) return answer.toLowerCase();
      console.log('[dev] expected a 32-character pairing code');
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const manifestPath = resolve(args.extensionDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`No manifest.json at ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);

  const extensionHostBundle = locateExtensionHostBundle();

  const configPath = resolve(args.extensionDir, 'dev.config.json');
  const bridge = createBridge({ port: args.bridgePort });
  const prepared = await ensurePairedAndPrepare(bridge, configPath, manifest.id);
  const denoBin = locateDeno(prepared.denoBin);

  const viteOrigin = `http://localhost:${args.vitePort}`;
  const { app } = createDevServer({
    extensionDir: args.extensionDir,
    hostPort: args.hostPort,
    viteOrigin,
    extensionHostBundle,
    denoBin,
    dbPath: prepared.dbPath,
    dataDir: prepared.dataDir,
    assetsDir: prepared.assetsDir,
    configPath
  });

  serve({ fetch: app.fetch, port: args.hostPort });

  // if the extension has its own vite.config.*, use it
  // (we assume it imports `branchFictionExtensionDev` to get the proxy)
  // otherwise generate a minimal config with the proxy + root inferred from manifest.
  const viteArgs = ['exec', 'vite', '--port', String(args.vitePort), '--strictPort'];
  if (!hasFile(args.extensionDir, 'vite.config')) {
    const entry = manifest.path?.entry as string | undefined;
    const root = entry ? posix.dirname(entry.replace(/^\.\/+/, '')) : '.';
    const generated = writeGeneratedViteConfig(args.extensionDir, root, args.hostPort);
    viteArgs.push('--config', generated);
  }
  const vite = spawn('pnpm', viteArgs, { cwd: args.extensionDir, stdio: 'inherit' });
  vite.on('exit', (code) => {
    console.log(`[dev] vite exited (code=${code})`);
    process.exit(code ?? 0);
  });

  // tsdown is optional, some extensions might not need a worker
  let tsdown: ReturnType<typeof spawn> | null = null;
  if (hasFile(args.extensionDir, 'tsdown.config')) {
    tsdown = spawn('pnpm', ['exec', 'tsdown', '--watch'], {
      cwd: args.extensionDir,
      stdio: 'inherit'
    });
    tsdown.on('exit', (code) => {
      if (code !== 0) console.warn(`[dev] tsdown exited (code=${code})`);
    });
  } else {
    console.log('[dev] no tsdown.config.* found — skipping worker bundle step');
  }

  process.on('SIGINT', () => {
    vite.kill();
    tsdown?.kill();
    process.exit(0);
  });
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
