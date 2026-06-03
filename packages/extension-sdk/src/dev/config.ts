import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { isUseSlotRequirement, type ExtensionManifestV1 } from '../manifest';
import type { DevConfig } from './types';

export function readDevConfig(path: string): DevConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DevConfig;
  } catch {
    return {};
  }
}

export function writeDevConfig(path: string, config: DevConfig): void {
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

export type DevConfigStatus = {
  ok: boolean;
  missing: string[];
};

// ensure every provider requirement supplies a binding (with API key when needed)
export function checkDevConfig(
  manifest: ExtensionManifestV1,
  config: DevConfig
): DevConfigStatus {
  const missing: string[] = [];
  const reqs = manifest.providers ?? [];
  for (const req of reqs) {
    const binding = config.providers?.[req.key];
    if (!binding) {
      missing.push(`providers.${req.key}`);
      continue;
    }
    if (isUseSlotRequirement(req)) {
      if (binding.kind !== 'useSlot') {
        missing.push(`providers.${req.key} (expected useSlot binding)`);
        continue;
      }
      if (!binding.providerType || !binding.modelKey || !binding.baseURL) {
        missing.push(`providers.${req.key} (incomplete useSlot binding)`);
      }
      if (binding.auth?.kind !== 'none' && !binding.apiKey) {
        missing.push(`providers.${req.key}.apiKey`);
      }
    } else {
      if (binding.kind !== 'options') {
        missing.push(`providers.${req.key} (expected options binding)`);
        continue;
      }
      const opt = req.options[binding.useIndex];
      if (!opt) {
        missing.push(`providers.${req.key}.useIndex out of range`);
        continue;
      }
      if (opt.auth.kind !== 'none' && !binding.apiKey) {
        missing.push(`providers.${req.key}.apiKey`);
      }
    }
  }
  return { ok: missing.length === 0, missing };
}
