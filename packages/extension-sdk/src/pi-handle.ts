import {
  type Api,
  getModel,
  getProviders,
  type KnownProvider,
  type Model,
  type ThinkingLevel
} from '@earendil-works/pi-ai';

export type PiModelHandle = {
  model: Model<Api>;
  apiKey?: string;
  reasoning?: ThinkingLevel;
};

export type BuildPiModelParams = {
  providerType: string;
  apiKey: string | null;
  baseUrl: string | null;
  modelId: string;
  reasoning: ThinkingLevel | null;
};

const PI_PROVIDER_ALIASES: Record<string, KnownProvider> = {
  google_gemini: 'google',
  vercel_ai_gateway: 'vercel-ai-gateway'
};

const PI_PROVIDERS = new Set<string>(getProviders());

export function resolvePiProvider(providerType: string): KnownProvider | undefined {
  const alias = PI_PROVIDER_ALIASES[providerType];
  if (alias) return alias;
  return PI_PROVIDERS.has(providerType) ? (providerType as KnownProvider) : undefined;
}

// xai models run via openai-responses instead of pi-ai's standard, completions API:
// 1. it's deprecated: https://docs.x.ai/developers/model-capabilities/text/comparison
// 2. prompt caching is non-standard with completions API
// we're also adding a custom thinkingLevelMap.
// todo: upstream PR? https://github.com/earendil-works/pi/issues/4308
// (this ended up being more complex than expected, needs a full transition over to responses API as well)
const XAI_OPENAI_RESPONSES_MODEL_IDS = new Set([
  'grok-4',
  'grok-4-fast',
  'grok-4-fast-non-reasoning',
  'grok-4.20-0309-non-reasoning',
  'grok-4.20-0309-reasoning',
  'grok-4.3'
]);

export function buildPiModel({
  providerType,
  apiKey,
  baseUrl,
  modelId,
  reasoning
}: BuildPiModelParams): PiModelHandle {
  const reasoningOpt = reasoning ?? undefined;
  const piProvider = resolvePiProvider(providerType);
  if (piProvider) {
    // cast here because modelId is user-configured at runtime
    const base = getModel(piProvider, modelId as never) as Model<Api>;
    let model: Model<Api> = baseUrl ? { ...base, baseUrl } : base;
    if (providerType === 'xai' && XAI_OPENAI_RESPONSES_MODEL_IDS.has(modelId)) {
      model = {
        ...model,
        api: 'openai-responses',
        thinkingLevelMap: { ...model.thinkingLevelMap, off: 'none' }
      };
    }
    return { model, apiKey: apiKey ?? undefined, reasoning: reasoningOpt };
  }

  switch (providerType) {
    case 'openai_compatible':
      if (!baseUrl) {
        throw new Error('"openai_compatible" providers require a baseUrl');
      }
      return {
        model: openAiCompatibleModel(providerType, modelId, baseUrl),
        apiKey: apiKey ?? undefined,
        reasoning: reasoningOpt
      };
    case 'anthropic_compatible':
      if (!baseUrl) {
        throw new Error('"anthropic_compatible" providers require a baseUrl');
      }
      return {
        model: anthropicCompatibleModel(providerType, modelId, baseUrl),
        apiKey: apiKey ?? undefined,
        reasoning: reasoningOpt
      };
    case 'ollama':
      return {
        model: openAiCompatibleModel(
          'ollama',
          modelId,
          baseUrl ?? 'http://localhost:11434/v1'
        ),
        apiKey: apiKey ?? 'ollama',
        reasoning: reasoningOpt
      };
    default:
      throw new Error(`Unsupported provider type for pi-ai: "${providerType}"`);
  }
}

function openAiCompatibleModel(
  provider: string,
  modelId: string,
  baseUrl: string
): Model<'openai-completions'> {
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256000,
    maxTokens: 32000
  };
}

function anthropicCompatibleModel(
  provider: string,
  modelId: string,
  baseUrl: string
): Model<'anthropic-messages'> {
  return {
    id: modelId,
    name: modelId,
    api: 'anthropic-messages',
    provider,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256000,
    maxTokens: 32000
  };
}
