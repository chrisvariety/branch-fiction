export interface CreateSessionInput {
  agentImageUrl: string;
  livekitUrl: string;
  livekitToken: string;
  agentPrompt?: string;
  idleTimeout?: number;
}

// LemonSlice joins our LiveKit room and lip-syncs the audio we stream; host proxy injects X-API-Key.
export async function createLemonSliceSession(
  proxyBaseURL: string,
  input: CreateSessionInput
): Promise<{ sessionId: string }> {
  const res = await fetch(`${proxyBaseURL}/api/liveai/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transport_type: 'livekit',
      agent_image_url: input.agentImageUrl,
      agent_prompt: input.agentPrompt ?? 'a person talking',
      idle_timeout: input.idleTimeout ?? 300,
      properties: { livekit_url: input.livekitUrl, livekit_token: input.livekitToken }
    })
  });
  if (!res.ok) {
    throw new Error(
      `LemonSlice session create failed: ${res.status} ${await res.text()}`
    );
  }
  const data = (await res.json()) as { session_id?: string };
  if (!data.session_id) {
    throw new Error('LemonSlice session create returned no session_id');
  }
  return { sessionId: data.session_id };
}
