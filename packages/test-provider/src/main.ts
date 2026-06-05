// Must run before any other import: pi-ai and its deps probe env vars
// (e.g. PI_CACHE_RETENTION) at module init time.
import '@/env-soft';
import { applyModelsCatalog } from '@branch-fiction/extension-sdk/models-catalog';
import { buildPiModel } from '@branch-fiction/extension-sdk/pi-handle';
import { complete } from '@earendil-works/pi-ai';

type Params = {
  providerType: string;
  modelId: string;
  proxyBaseUrl: string;
  modelsCatalogPath?: string | null;
};

type Result = { ok: true } | { ok: false; error: string };

const encoder = new TextEncoder();

function emit(result: Result): void {
  Deno.stdout.writeSync(encoder.encode(`${JSON.stringify(result)}\n`));
}

async function readStdinLine(): Promise<string> {
  const reader = Deno.stdin.readable.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const nl = buf.indexOf('\n');
    if (nl !== -1) {
      reader.releaseLock();
      return buf.slice(0, nl);
    }
  }
  reader.releaseLock();
  return buf;
}

async function loadModelsCatalog(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    applyModelsCatalog(JSON.parse(await Deno.readTextFile(path)));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.error(`[test-provider] failed to load models catalog: ${e}`);
    }
  }
}

async function run(params: Params): Promise<Result> {
  const { providerType, modelId, proxyBaseUrl } = params;
  if (!providerType) return { ok: false, error: 'Missing providerType' };
  if (!modelId) return { ok: false, error: 'Missing modelId' };
  if (!proxyBaseUrl) return { ok: false, error: 'Missing proxyBaseUrl' };

  await loadModelsCatalog(params.modelsCatalogPath);

  const { model, apiKey, reasoning } = buildPiModel({
    providerType,
    apiKey: 'unused-system-proxy-injects',
    baseUrl: proxyBaseUrl,
    modelId,
    reasoning: null
  });

  const message = await complete(
    model,
    {
      messages: [
        {
          role: 'user',
          content: 'Reply with the single word "ok".',
          timestamp: Date.now()
        }
      ]
    },
    { apiKey, reasoning, maxTokens: 16 }
  );

  if (message.stopReason === 'error') {
    return { ok: false, error: message.errorMessage || 'provider returned an error' };
  }
  return { ok: true };
}

try {
  const raw = await readStdinLine();
  const params = JSON.parse(raw) as Params;
  emit(await run(params));
} catch (e) {
  emit({ ok: false, error: e instanceof Error ? e.message : String(e) });
}
Deno.exit(0);
