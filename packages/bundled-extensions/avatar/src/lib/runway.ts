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

interface RunwayAvatar {
  id: string;
  status: string;
  documentIds?: string[];
}

interface RunwayDocument {
  id: string;
}

// Runway's safety filter rejected the personality or start script text.
export class RunwayContentRejectedError extends Error {
  constructor(message?: string) {
    super(message ?? 'Runway rejected this text');
    this.name = 'RunwayContentRejectedError';
  }
}

export function isContentRejected(error: unknown): boolean {
  return error instanceof RunwayContentRejectedError;
}

// A scenario's per-session overrides plus its knowledge document state.
export interface ScenarioSession {
  personality: string;
  startScript: string;
  documentName: string;
  knowledge: string;
  knowledgeHash: string;
  existingDocumentId: string | null;
  existingDocumentHash: string | null;
  onDocumentReady: (documentId: string, knowledgeHash: string) => Promise<void>;
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
    const body = await res.text();
    if (res.status === 400 && /cannot be used for an avatar/i.test(body)) {
      throw new RunwayContentRejectedError(body);
    }
    throw new Error(`Runway ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The avatar must finish processing on Runway's side before a session can use it.
export async function ensureAvatarReady(avatarId: string): Promise<void> {
  const avatar = (await runwayFetch(`/v1/avatars/${avatarId}`)) as RunwayAvatar;
  const status = avatar.status.toUpperCase();
  if (status === 'READY' || status === 'AVATARREADY') return;
  if (status.includes('PROCESSING')) {
    throw new Error('Runway is still processing this avatar — try again in a moment.');
  }
  throw new Error(`Runway avatar is not ready (status: ${avatar.status}).`);
}

// Reuse the cached document when its content is unchanged; otherwise create or update it.
async function ensureScenarioDocument(scenario: ScenarioSession): Promise<string> {
  if (
    scenario.existingDocumentId &&
    scenario.existingDocumentHash === scenario.knowledgeHash
  ) {
    return scenario.existingDocumentId;
  }

  let documentId: string;
  if (scenario.existingDocumentId) {
    await runwayFetch(`/v1/documents/${scenario.existingDocumentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: scenario.knowledge })
    });
    documentId = scenario.existingDocumentId;
  } else {
    const created = (await runwayFetch('/v1/documents', {
      method: 'POST',
      body: JSON.stringify({ name: scenario.documentName, content: scenario.knowledge })
    })) as RunwayDocument;
    documentId = created.id;
  }

  await scenario.onDocumentReady(documentId, scenario.knowledgeHash);
  return documentId;
}

// documentIds replaces all attachments, so this scopes the avatar's knowledge to one scenario.
async function attachDocument(avatarId: string, documentId: string): Promise<void> {
  await runwayFetch(`/v1/avatars/${avatarId}`, {
    method: 'PATCH',
    body: JSON.stringify({ documentIds: [documentId] })
  });
}

// Create the session, poll until ready, then consume it so the SDK connects straight to LiveKit.
export async function connectAvatarSession(
  avatarId: string,
  scenario?: ScenarioSession
): Promise<SessionCredentials> {
  await ensureAvatarReady(avatarId);

  const sessionBody: Record<string, unknown> = {
    model: 'gwm1_avatars',
    avatar: { type: 'custom', avatarId }
  };

  if (scenario) {
    const documentId = await ensureScenarioDocument(scenario);
    await attachDocument(avatarId, documentId);
    sessionBody.personality = scenario.personality;
    sessionBody.startScript = scenario.startScript;
  }

  const created = (await runwayFetch('/v1/realtime_sessions', {
    method: 'POST',
    body: JSON.stringify(sessionBody)
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
