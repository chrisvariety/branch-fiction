import { parseAssetUrl } from '@branch-fiction/extension-sdk/media/transform-url';
import { UnrecoverableError } from '@branch-fiction/extension-sdk/worker/error-types';
import { v7 as uuidv7 } from 'uuid';

import { createLemonSliceSession } from '@/lib/avatar/lemonslice-session';
import { signLiveKitToken } from '@/lib/avatar/livekit-token';
import { uploadAvatarImage } from '@/lib/avatar/upload-image';
import { ensureDbReady } from '@/worker/db';
import { getAvatar } from '@/worker/db/models/avatar/get-avatar';
import { createWorkflowFunction } from '@/worker/handler';
import { getProvider } from '@/worker/providers';

const SESSION_TTL_SECONDS = 30 * 60;
const AVATAR_IDENTITY = 'lemonslice-avatar-agent';
const CLIENT_IDENTITY = 'reader';

export interface StartAvatarSessionPayload {
  characterId: string;
}

export interface StartAvatarSessionResult {
  livekitUrl: string;
  livekitToken: string;
  avatarIdentity: string;
  sessionId: string;
}

export async function startAvatarSession(
  payload: StartAvatarSessionPayload
): Promise<StartAvatarSessionResult> {
  await ensureDbReady();
  return runStartAvatarSession({ executionId: uuidv7(), payload });
}

function requiredConfig(key: string): string {
  const value = host.config[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new UnrecoverableError(`Missing extension config: ${key}`);
  }
  return value;
}

const runStartAvatarSession = createWorkflowFunction<
  StartAvatarSessionPayload,
  StartAvatarSessionPayload,
  StartAvatarSessionResult
>({ name: 'Start avatar session' }, async ({ characterId }, ctx) => {
  if (host.bookId === null) {
    throw new UnrecoverableError(
      'startAvatarSession requires a bookId — launch from a book'
    );
  }

  const avatar = await getAvatar(host.bookId, characterId);
  if (!avatar) {
    throw new UnrecoverableError('No prepared avatar for this character');
  }

  const { relPath, mimeType } = parseAssetUrl(avatar.imageUrl);
  const imageBytes = await ctx.fs.read(relPath);

  ctx.log.info('Uploading portrait to the public image host');
  const agentImageUrl = await uploadAvatarImage(imageBytes, mimeType);

  const livekitUrl = requiredConfig('livekit_url');
  const apiKey = requiredConfig('livekit_api_key');
  const apiSecret = requiredConfig('livekit_api_secret');
  const room = `avatar-${uuidv7()}`;

  ctx.log.info('Minting LiveKit tokens');
  const [livekitToken, avatarToken] = await Promise.all([
    signLiveKitToken({
      apiKey,
      apiSecret,
      identity: CLIENT_IDENTITY,
      room,
      ttlSeconds: SESSION_TTL_SECONDS,
      kind: 'agent'
    }),
    signLiveKitToken({
      apiKey,
      apiSecret,
      identity: AVATAR_IDENTITY,
      room,
      ttlSeconds: SESSION_TTL_SECONDS,
      attributes: { 'lk.publish_on_behalf': CLIENT_IDENTITY },
      kind: 'agent'
    })
  ]);

  ctx.log.info('Starting the LemonSlice avatar session');
  const { sessionId } = await createLemonSliceSession(
    getProvider('avatar').proxyBaseURL,
    {
      agentImageUrl,
      livekitUrl,
      livekitToken: avatarToken
    }
  );

  ctx.log.withMetadata({ sessionId, room }).info('Avatar session ready');
  return { livekitUrl, livekitToken, avatarIdentity: AVATAR_IDENTITY, sessionId };
});
