import {
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrandVercel,
  IconBrandX,
  IconKey
} from '@tabler/icons-react';
import type { ComponentType } from 'react';

import type { ProviderTypeKey } from '@/lib/llm/providers';

import { IconBrandAnthropic } from './anthropic';
import { IconBrandCerebras } from './cerebras';
import { IconBrandDeepseek } from './deepseek';
import { IconBrandFireworks } from './fireworks';
import { IconBrandGroq } from './groq';
import { IconBrandHuggingFace } from './huggingface';
import { IconBrandMiniMax } from './minimax';
import { IconBrandMistral } from './mistral';
import { IconBrandMoonshot } from './moonshot';
import { IconBrandNvidia } from './nvidia';
import { IconBrandOllama } from './ollama';
import { IconBrandOpenRouter } from './openrouter';
import { IconBrandTogetherAI } from './together';
import { IconBrandXiaomi } from './xiaomi';
import { IconBrandZAI } from './zai';

export type ProviderIcon = ComponentType<{ className?: string }>;

export const PROVIDER_ICONS: Record<ProviderTypeKey, ProviderIcon> = {
  xai: IconBrandX,
  google_gemini: IconBrandGoogle,
  openai: IconBrandOpenai,
  openai_compatible: IconBrandOpenai,
  anthropic: IconBrandAnthropic,
  anthropic_compatible: IconBrandAnthropic,
  openrouter: IconBrandOpenRouter,
  ollama: IconBrandOllama,
  vercel_ai_gateway: IconBrandVercel,
  deepseek: IconBrandDeepseek,
  huggingface: IconBrandHuggingFace,
  minimax: IconBrandMiniMax,
  mistral: IconBrandMistral,
  moonshotai: IconBrandMoonshot,
  nvidia: IconBrandNvidia,
  xiaomi: IconBrandXiaomi,
  cerebras: IconBrandCerebras,
  groq: IconBrandGroq,
  together: IconBrandTogetherAI,
  zai: IconBrandZAI,
  fireworks: IconBrandFireworks
};

export function getProviderIcon(type: string): ProviderIcon {
  return PROVIDER_ICONS[type as ProviderTypeKey] ?? IconKey;
}
