import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack
} from 'livekit-client';
import { v7 as uuidv7 } from 'uuid';

import type { AvatarAdapter, AvatarSession, StartSessionOptions } from './types';

export const LEMONSLICE_PROVIDER = 'lemonslice';

// The avatar consumes our TTS over this LiveKit byte-stream topic (matches livekit-agents).
const AUDIO_STREAM_TOPIC = 'lk.audio_stream';
const WRITE_CHUNK_BYTES = 16_000;

function log(...args: unknown[]): void {
  console.info('[avatar/livekit]', ...args);
}

// Stop the avatar session so it stops consuming credits.
async function terminateSession(opts: StartSessionOptions): Promise<void> {
  try {
    await fetch(
      `${opts.avatarProxyBaseURL}/api/liveai/sessions/${opts.sessionId}/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'terminate' })
      }
    );
  } catch (e) {
    log('terminate failed', e);
  }
}

export const lemonsliceAvatarAdapter: AvatarAdapter = {
  provider: LEMONSLICE_PROVIDER,

  async startSession(opts: StartSessionOptions): Promise<AvatarSession> {
    const room = new Room();

    const attach = (track: RemoteTrack, participant: RemoteParticipant): void => {
      if (participant.identity !== opts.avatarIdentity) return;
      if (track.kind === Track.Kind.Video) track.attach(opts.videoElement);
      else if (track.kind === Track.Kind.Audio) track.attach(opts.audioElement);
    };

    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) =>
      attach(track, participant)
    );
    room.on(RoomEvent.ParticipantConnected, (p) =>
      log('participant-connected', p.identity)
    );
    room.on(RoomEvent.Disconnected, () => log('disconnected'));
    if (opts.onError) {
      room.on(RoomEvent.MediaDevicesError, (e) => opts.onError?.(e.message));
    }

    // The avatar calls these back on us; answer so it doesn't error.
    room.registerRpcMethod('lk.playback_started', async () => '');
    room.registerRpcMethod('lk.playback_finished', async () => '');

    await room.connect(opts.livekitUrl, opts.livekitToken);
    log('connected', opts.livekitUrl);

    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) attach(publication.track, participant);
      }
    }

    let aborted = false;

    const streamUtterance = async (
      bytes: Uint8Array,
      sampleRate: number
    ): Promise<void> => {
      try {
        const writer = await room.localParticipant.streamBytes({
          name: `AUDIO_${uuidv7()}`,
          topic: AUDIO_STREAM_TOPIC,
          destinationIdentities: [opts.avatarIdentity],
          attributes: { sample_rate: String(sampleRate), num_channels: '1' }
        });
        for (let i = 0; i < bytes.length && !aborted; i += WRITE_CHUNK_BYTES) {
          await writer.write(
            bytes.slice(i, Math.min(i + WRITE_CHUNK_BYTES, bytes.length))
          );
        }
        await writer.close();
      } catch (e) {
        log('stream failed', e);
      }
    };

    return {
      playPcm16(bytes: Uint8Array, sampleRate: number): void {
        if (bytes.length === 0) return;
        aborted = false;
        void streamUtterance(bytes, sampleRate);
      },

      interrupt(): void {
        aborted = true;
        // Resumes audio under autoplay policy (runs inside the talk-press gesture).
        void room.startAudio().catch(() => {});
        void room.localParticipant
          .performRpc({
            destinationIdentity: opts.avatarIdentity,
            method: 'lk.clear_buffer',
            payload: ''
          })
          .catch(() => {});
      },

      async close(): Promise<void> {
        aborted = true;
        await terminateSession(opts);
        await room.disconnect().catch(() => {});
      }
    };
  }
};
