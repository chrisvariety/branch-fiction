import { transformImageUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import {
  firstFrameImageIssue,
  MAX_FIRST_FRAME_IMAGE_BYTES,
  type HappyOysterCanonicalMode
} from '@reactor-models/happy-oyster';

import type { OysterModel, WorldModel } from '@/lib/db/types';

export type ReactorSdkModel = Extract<WorldModel, 'helios' | 'lingbot'>;

// Only the js-sdk models
export const MODEL_NAMES: Record<ReactorSdkModel, string> = {
  helios: 'helios',
  lingbot: 'reactor/lingbot-world-2'
};

const OYSTER_MODES: Record<OysterModel, HappyOysterCanonicalMode> = {
  'oyster-adventure': 'adventure',
  'oyster-directing': 'directing'
};

export function isOysterModel(model: WorldModel): model is OysterModel {
  return model in OYSTER_MODES;
}

export function oysterMode(model: OysterModel): HappyOysterCanonicalMode {
  return OYSTER_MODES[model];
}

const TOKEN_LIFETIME_SECONDS = 3600;

// Mints a short-lived Reactor JWT through the host proxy, which injects the rk_ key.
export async function getReactorJwt(): Promise<string> {
  const provider = window.extensionSDK.providers['reactor_token'];
  if (!provider) throw new Error('reactor_token provider is not configured');
  const res = await fetch(`${provider.proxyBaseURL}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_after: TOKEN_LIFETIME_SECONDS })
  });
  if (!res.ok) {
    throw new Error(`Reactor token mint failed: ${res.status} ${await res.text()}`);
  }
  const { jwt } = (await res.json()) as { jwt: string };
  return jwt;
}

// The seed image is stored as a file:// asset URL; resolve to the host URL and fetch its bytes.
export async function fetchSeedImageBlob(seedImageUrl: string): Promise<Blob> {
  const hostUrl = transformImageUrl(seedImageUrl);
  const res = await fetch(hostUrl);
  if (!res.ok) throw new Error(`Failed to load seed image: ${res.status}`);
  return res.blob();
}

const JPEG_QUALITY_STEPS = [0.9, 0.75, 0.6, 0.45];

// HappyOyster caps first frames at 2 MB; our 16:9 seeds sit inside its 1.5–2.0 ratio window.
export async function prepareFirstFrame(seedImageUrl: string): Promise<Blob> {
  let blob = await fetchSeedImageBlob(seedImageUrl);
  if (blob.size > MAX_FIRST_FRAME_IMAGE_BYTES) {
    blob = await recompress(blob);
  }
  const issue = await firstFrameImageIssue(blob);
  if (issue) throw new Error(`Seed image rejected: ${issue}`);
  return blob;
}

async function recompress(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not resize the seed image (no 2d context)');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  for (const quality of JPEG_QUALITY_STEPS) {
    const candidate = await toBlob(canvas, quality);
    if (candidate.size <= MAX_FIRST_FRAME_IMAGE_BYTES) return candidate;
  }
  throw new Error('Seed image is too large for HappyOyster even after recompression');
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result ? resolve(result) : reject(new Error('Canvas encoding produced no blob')),
      'image/jpeg',
      quality
    );
  });
}
