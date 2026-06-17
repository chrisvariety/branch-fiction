import type { SessionCredentials } from '@runwayml/avatars-react';
import { consumeSession } from '@runwayml/avatars-react/api';

// Consume + LiveKit calls hit the real API directly with the short-lived sessionKey.
export const RUNWAY_API_BASE = 'https://api.dev.runwayml.com';
const RUNWAY_VERSION = '2024-11-06';
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED']);

interface RealtimeSession {
  id: string;
  status: string;
  sessionKey?: string;
}

function proxyBase(): string {
  const provider = window.extensionSDK.providers['runway_api_key'];
  if (!provider) throw new Error('Runway API key is not configured for this extension');
  return provider.proxyBaseURL;
}

// Session creation needs the API secret, so it goes through the host proxy which injects it.
async function runwayFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${proxyBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Runway-Version': RUNWAY_VERSION,
      ...init?.headers
    }
  });
  if (!res.ok) {
    throw new Error(`Runway ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Create the session, poll until ready, then consume it so the SDK connects straight to LiveKit.
export async function connectAvatarSession(
  avatarId: string
): Promise<SessionCredentials> {
  const created = (await runwayFetch('/v1/realtime_sessions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'gwm1_avatars',
      avatar: { type: 'custom', avatarId }
    })
  })) as RealtimeSession;

  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const session = (await runwayFetch(
      `/v1/realtime_sessions/${created.id}`
    )) as RealtimeSession;

    if (session.status === 'READY' && session.sessionKey) {
      const { url, token, roomName } = await consumeSession({
        sessionId: created.id,
        sessionKey: session.sessionKey,
        baseUrl: RUNWAY_API_BASE
      });
      return { sessionId: created.id, serverUrl: url, token, roomName };
    }
    if (TERMINAL_STATUSES.has(session.status)) {
      throw new Error(
        `Runway session ${session.status.toLowerCase()} before it was ready`
      );
    }
    if (Date.now() > deadline) {
      throw new Error('Runway session timed out before becoming ready');
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
