import { type ThinkingLevel } from '@earendil-works/pi-ai';

import {
  buildPiModel,
  type PiModelHandle,
  resolvePiProvider
} from '@/app/lib/llm/pi-handle';
import type { Slot } from '@/app/lib/llm/providers';

import type { SlotInfo } from '../bridge';

export type { PiModelHandle, Slot };
export { resolvePiProvider };

export function createGetPiModel(
  slots: Record<string, SlotInfo>,
  proxyBaseUrl: string
): (slot: Slot) => PiModelHandle {
  return (slot) => {
    const info = slots[slot];
    if (!info) {
      throw new Error(`No provider model configured for slot "${slot}"`);
    }
    return buildPiModel({
      providerType: info.providerType,
      apiKey: 'unused-system-proxy-injects',
      baseUrl: `${proxyBaseUrl}/${slot}`,
      modelId: info.modelId,
      reasoning: (info.reasoning ?? null) as ThinkingLevel | null
    });
  };
}
