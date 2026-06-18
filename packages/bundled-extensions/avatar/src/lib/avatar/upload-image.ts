const AVATAR_IMAGE_ENDPOINT = 'https://cloud.branchfiction.com/avatar-image';

interface UploadResult {
  result?: { url: string; expiresAt: number };
  errors?: { code: number; message: string }[];
}

// Uploads portrait bytes to the short-TTL public host; returns a URL a provider can fetch once.
export async function uploadAvatarImage(
  bytes: Uint8Array,
  mimeType: string
): Promise<string> {
  const res = await fetch(AVATAR_IMAGE_ENDPOINT, {
    method: 'POST',
    body: new Blob([bytes as BufferSource], { type: mimeType })
  });
  const data = (await res.json().catch(() => ({}))) as UploadResult;
  if (!res.ok || !data.result?.url) {
    throw new Error(
      `Avatar image upload failed: ${res.status} ${data.errors?.[0]?.message ?? ''}`
    );
  }
  return data.result.url;
}
