import { invoke } from '@tauri-apps/api/core';

import { getExtensionProviderBindings } from '../lib/db/models/extension-provider/get-extension-provider';
import { getExtensionById } from '../lib/db/models/extension/get-extension';
import { getDefaultTextModelId } from '../lib/db/models/organization-text-model/organization-text-model';
import { SLOT_LABELS } from '../lib/llm/providers';
import { isUseSlotRequirement, type ExtensionManifestV1 } from './manifest';

// QR-exposed phone-share JWTs use a tighter TTL than the desktop iframe flow.
export const PHONE_SESSION_TTL_SECS = 60 * 60;

type MintSessionResponse = {
  token: string;
  dataBaseUrl: string;
  proxyBaseUrl: string;
};

export async function mintSession({
  extensionId,
  bookId,
  ttlSecs
}: {
  extensionId: string;
  bookId?: string | null;
  ttlSecs?: number;
}): Promise<MintSessionResponse> {
  const extension = await getExtensionById(extensionId);
  if (!extension) throw new Error(`Extension not found: ${extensionId}`);
  const manifest = extension.manifest as ExtensionManifestV1;
  const reqs = manifest.providers ?? [];

  const useSlotReqs = reqs.filter(isUseSlotRequirement);
  if (useSlotReqs.length > 0) {
    const bindings = await getExtensionProviderBindings(extensionId);
    for (const req of useSlotReqs) {
      const hasOverride = bindings.some((b) => b.providerKey === req.key && b.modelKey);
      if (hasOverride) continue;
      const modelId = await getDefaultTextModelId(req.useSlot);
      if (!modelId) {
        throw new Error(
          `Extension "${extension.name}" needs a ${SLOT_LABELS[req.useSlot]} model — add a provider in Settings → Providers.`
        );
      }
    }
  }

  return invoke<MintSessionResponse>('mint_extension_session_token', {
    args: {
      extensionId,
      bookId: bookId ?? null,
      ttlSecs: ttlSecs ?? null
    }
  });
}

export async function revokeSession(extensionId: string): Promise<void> {
  await invoke('revoke_extension_session_tokens', { extensionId });
}
