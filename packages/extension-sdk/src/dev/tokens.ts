import { randomUUID } from 'node:crypto';

import type { ThinkingLevel } from '@earendil-works/pi-ai';

import {
  isUseSlotRequirement,
  optionURL,
  type ExtensionManifestV1,
  type ExtensionProviderRequirement
} from '../manifest';
import type { ProviderAuthShape } from '../types';
import type { DevConfig, DevProviderBinding } from './types';

export type ResolvedProvider = {
  baseURL: string;
  auth: ProviderAuthShape;
  apiKey?: string;
};

export type ProviderHandle = {
  baseURL: string;
  proxyBaseURL: string;
  modelKey?: string;
  providerType?: string;
  reasoning?: ThinkingLevel;
};

type ProxySession = { providerKey: string };

class TokenRegistry {
  private dataToken: string | null = null;
  private proxyTokens = new Map<string, ProxySession>();
  private tokenByKey = new Map<string, string>();
  private resolved = new Map<string, ResolvedProvider>();
  private handles: Record<string, ProviderHandle> = {};

  mintDataToken(): string {
    if (!this.dataToken) {
      this.dataToken = `pdt_${randomUUID().replace(/-/g, '')}`;
    }
    return this.dataToken;
  }

  getDataToken(): string {
    return this.mintDataToken();
  }

  buildProviders(
    manifest: ExtensionManifestV1,
    config: DevConfig,
    hostOrigin: string
  ): Record<string, ProviderHandle> {
    this.resolved.clear();
    this.handles = {};
    const reqs = manifest.providers ?? [];
    for (const req of reqs) {
      const binding = config.providers?.[req.key];
      if (!binding) continue;
      const resolved = resolveBinding(req, binding);
      if (!resolved) continue;
      let token = this.tokenByKey.get(req.key);
      if (!token) {
        token = `pps_${randomUUID().replace(/-/g, '')}`;
        this.tokenByKey.set(req.key, token);
        this.proxyTokens.set(token, { providerKey: req.key });
      }
      this.resolved.set(req.key, resolved);
      const proxyBaseURL = `${hostOrigin}/extension-providers/${token}/${encodeURIComponent(req.key)}`;
      const handle: ProviderHandle = {
        baseURL: resolved.baseURL,
        proxyBaseURL
      };
      if (isUseSlotRequirement(req) && binding.kind === 'useSlot') {
        handle.modelKey = binding.modelKey;
        handle.providerType = binding.providerType;
        if (binding.reasoning) handle.reasoning = binding.reasoning;
      } else if (binding.kind === 'options' && !isUseSlotRequirement(req)) {
        const opt = req.options[binding.useIndex];
        if (opt?.model) handle.modelKey = opt.model;
      }
      this.handles[req.key] = handle;
    }
    return this.handles;
  }

  resolveProxyForKey(token: string, providerKey: string): ResolvedProvider | null {
    const session = this.proxyTokens.get(token);
    if (!session || session.providerKey !== providerKey) return null;
    return this.resolved.get(providerKey) ?? null;
  }

  isValidDataToken(token: string): boolean {
    return this.dataToken !== null && token === this.dataToken;
  }
}

function resolveBinding(
  req: ExtensionProviderRequirement,
  binding: DevProviderBinding
): ResolvedProvider | null {
  if (isUseSlotRequirement(req)) {
    if (binding.kind !== 'useSlot') return null;
    return {
      baseURL: binding.baseURL,
      auth: binding.auth,
      apiKey: binding.apiKey
    };
  }
  if (binding.kind !== 'options') return null;
  const opt = req.options[binding.useIndex];
  if (!opt) return null;
  // Author can override `fullURL` placeholders via dev.config.json.
  const baseURL = binding.fullURL ?? optionURL(opt);
  return {
    baseURL,
    auth: opt.auth,
    apiKey: binding.apiKey
  };
}

export const registry = new TokenRegistry();
