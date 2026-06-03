type TransformOptions = {
  variant?: string;
  optimize?: boolean;
};

function assetUrl(bucket: string, key: string): string {
  const { extensionId, hostOrigin } = window.extensionSDK;
  if (!extensionId) {
    throw new Error('asset URL requested before extension SDK was ready');
  }
  return `${hostOrigin}/extension-data/${encodeURIComponent(extensionId)}/assets/${bucket}/${key}`;
}

export function transformImageUrl(imageUrl: string, _options: TransformOptions = {}) {
  const { bucket, key } = parseStorageUrl(imageUrl);
  return assetUrl(bucket, key);
}

export function cropToFace(imageUrl: string, _options: TransformOptions = {}) {
  const { bucket, key } = parseStorageUrl(imageUrl);
  return assetUrl(bucket, key);
}

export function transformVideoUrl(videoUrl: string, _options: TransformOptions = {}) {
  const { bucket, key } = parseStorageUrl(videoUrl);
  return assetUrl(bucket, key);
}

function parseStorageUrl(url: string): { bucket: string; key: string } {
  const parsed = new URL(url);
  if (parsed.protocol !== 'r2:' && parsed.protocol !== 'file:') {
    throw new Error(`Invalid storage URL protocol: ${url}`);
  }
  return {
    bucket: parsed.hostname,
    key: parsed.pathname.slice(1)
  };
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm'
};

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm'
};

export function mimeTypeToExtension(mimeType: string): string {
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) throw new Error(`Unknown mime type: ${mimeType}`);
  return ext;
}

export function extensionToMimeType(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

// `key` should already include any subdirectory and a stable id (no extension)
export function buildAssetUrl(key: string, mimeType: string): string {
  return `file://${key}.${mimeTypeToExtension(mimeType)}`;
}

export function parseAssetUrl(url: string): { relPath: string; mimeType: string } {
  const { bucket, key } = parseStorageUrl(url);
  const relPath = `${bucket}/${key}`;
  const dotIdx = relPath.lastIndexOf('.');
  const ext = dotIdx >= 0 ? relPath.slice(dotIdx + 1) : '';
  return { relPath, mimeType: extensionToMimeType(ext) };
}
