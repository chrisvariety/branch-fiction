import { invoke } from '@tauri-apps/api/core';

import { createExtension } from '../lib/db/models/extension/create-extension';
import { getExtensionById } from '../lib/db/models/extension/get-extension';
import { updateExtensionById } from '../lib/db/models/extension/update-extension';
import {
  defaultsFromManifest,
  hasMissingConfigFields,
  validateManifest,
  type ExtensionManifestV1
} from './manifest';

async function readBundledManifest(dir: string): Promise<ExtensionManifestV1> {
  const raw = await invoke<string>('read_extension_manifest_at', { sourcePath: dir });
  let parsed: ExtensionManifestV1;
  try {
    parsed = JSON.parse(raw) as ExtensionManifestV1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`bundled manifest.json at ${dir} is not valid JSON: ${message}`);
  }
  validateManifest(parsed);
  return parsed;
}

export async function syncBundledExtensions(): Promise<void> {
  const dirs = await invoke<string[]>('list_bundled_extension_dirs');
  for (const dir of dirs) {
    try {
      await syncBundledExtension(dir);
    } catch (err) {
      console.error(`Failed to sync bundled extension at ${dir}:`, err);
    }
  }
}

async function syncBundledExtension(dir: string): Promise<void> {
  const manifest = await readBundledManifest(dir);
  const existing = await getExtensionById(manifest.id);

  if (existing) {
    if (existing.provenanceType !== 'bundled') {
      // A user-installed extension with this id already exists; leave it alone.
      return;
    }
    if (existing.version === manifest.version && existing.path === dir) {
      return;
    }
    await updateExtensionById(manifest.id, {
      name: manifest.name,
      version: manifest.version,
      path: dir,
      manifest
    });
    return;
  }

  const defaults = defaultsFromManifest(manifest);
  await createExtension({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    path: dir,
    manifest,
    config: defaults,
    enabled: !hasMissingConfigFields(manifest, defaults),
    provenanceType: 'bundled',
    provenanceConfig: {}
  });
}
