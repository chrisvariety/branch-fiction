function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeSegment(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

export interface LiveKitTokenInput {
  apiKey: string;
  apiSecret: string;
  identity: string;
  room: string;
  ttlSeconds: number;
  attributes?: Record<string, string>;
  kind?: string;
}

// Mint a LiveKit access token (HS256 JWT) — same claim shape as livekit-server-sdk's AccessToken.
export async function signLiveKitToken(input: LiveKitTokenInput): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: input.apiKey,
    sub: input.identity,
    name: input.identity,
    nbf: now,
    exp: now + input.ttlSeconds,
    video: {
      room: input.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    }
  };
  if (input.attributes) payload.attributes = input.attributes;
  if (input.kind) payload.kind = input.kind;

  const signingInput = `${encodeSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeSegment(payload)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64url(new Uint8Array(sig))}`;
}
