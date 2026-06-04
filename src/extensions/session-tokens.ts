import { invoke } from '@tauri-apps/api/core';

import { DEFAULT_ORG_ID } from '../lib/auth';
import { getExtensionProviderBindings } from '../lib/db/models/extension-provider/get-extension-provider';
import { getExtensionById } from '../lib/db/models/extension/get-extension';
import {
  getOrganizationTextModel,
  setOrganizationTextModel
} from '../lib/db/models/organization-text-model/organization-text-model';
import { getProvidersByOrganizationId } from '../lib/db/models/provider/get-provider';
import { SLOT_LABELS, type Slot } from '../lib/llm/providers';
import { defaultTextProvider, primaryTextModel } from '../lib/llm/text-model';
import { isUseSlotRequirement, type ExtensionManifestV1 } from './manifest';

// QR-exposed phone-share JWTs use a tighter TTL than the desktop iframe flow.
export const PHONE_SESSION_TTL_SECS = 60 * 60;

type MintSessionResponse = {
  token: string;
  dataBaseUrl: string;
  proxyBaseUrl: string;
};

// The org default is normally set during book import; until then, fall back to the newest usable text provider.
async function ensureDefaultTextModelId(slot: Slot): Promise<string | null> {
  const row = await getOrganizationTextModel();
  const current =
    slot === 'piTextLight' ? row?.textLightProviderModelId : row?.textProviderModelId;
  if (current) return current;

  const providers = await getProvidersByOrganizationId(DEFAULT_ORG_ID);
  const provider = defaultTextProvider(providers);
  const model = provider ? primaryTextModel(provider) : null;
  if (!model) return null;

  await setOrganizationTextModel({
    textProviderModelId: row?.textProviderModelId ?? model.id,
    textLightProviderModelId: row?.textLightProviderModelId ?? model.id
  });
  return model.id;
}

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
      const modelId = await ensureDefaultTextModelId(req.useSlot);
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
