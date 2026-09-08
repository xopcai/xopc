import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import {
  claimAudioPlayback,
  isAudioCaptureActive,
  releaseAudioPlayback,
} from '../voice/audio-playback-coordinator';

import {
  AssistantAudioAutoplayQueue,
  type AssistantAudioAutoplayItem,
  type AssistantAudioAutoplayResult,
} from './assistant-audio-autoplay-queue';
import type { AudioContent } from './messages.types';
import { buildGatewayMediaReadPath, isMediaUri } from './media-uri';
import { MessageAudioCache } from './message-audio-cache';

const AUTOPLAY_OWNER = 'assistant-audio-autoplay';

async function waitForCaptureRelease(): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isAudioCaptureActive()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isAudioCaptureActive();
}

async function playTrack(item: AssistantAudioAutoplayItem): Promise<AssistantAudioAutoplayResult> {
  if (!await waitForCaptureRelease()) return 'interrupted';
  const cache = isMediaUri(item.uri) ? new MessageAudioCache() : null;
  const playback: { player: AudioPlayer | null } = { player: null };
  let settled = false;
  let listener: { remove(): void } | undefined;

  try {
    const playbackUri = cache
      ? await cache.download(buildGatewayMediaReadPath(item.uri, item.sessionKey), item.mimeType)
      : item.uri;
    if (isAudioCaptureActive()) return 'interrupted';
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });

    return await new Promise<AssistantAudioAutoplayResult>((resolve, reject) => {
      const finish = (result: AssistantAudioAutoplayResult, error?: unknown) => {
        if (settled) return;
        settled = true;
        listener?.remove();
        releaseAudioPlayback(AUTOPLAY_OWNER);
        try { playback.player?.remove(); } catch { /* The player may already be released. */ }
        playback.player = null;
        if (error) reject(error);
        else resolve(result);
      };

      try {
        playback.player = createAudioPlayer(playbackUri, { updateInterval: 250 });
        listener = playback.player.addListener('playbackStatusUpdate', (status) => {
          if (status.error) finish('completed', new Error(status.error));
          else if (status.didJustFinish) finish('completed');
        });
        claimAudioPlayback(AUTOPLAY_OWNER, () => finish('interrupted'));
        playback.player.play();
      } catch (error) {
        finish('completed', error);
      }
    });
  } finally {
    cache?.remove();
    if (!settled) {
      listener?.remove();
      releaseAudioPlayback(AUTOPLAY_OWNER);
      try { playback.player?.remove(); } catch { /* Ignore cleanup races. */ }
    }
  }
}

const autoplayQueue = new AssistantAudioAutoplayQueue(async (item) => {
  try {
    return await playTrack(item);
  } catch (error) {
    console.warn('[AssistantAudioAutoplay] Playback failed', error);
    throw error;
  }
});

/** Plays only newly streamed assistant audio; persisted history remains user-initiated. */
export function queueAssistantAudioAutoplay(audio: AudioContent, sessionKey: string): void {
  const uri = audio.uri?.trim();
  if (!uri) return;
  autoplayQueue.enqueue({
    key: `${sessionKey}:${uri}`,
    uri,
    mimeType: audio.mimeType,
    sessionKey,
  });
}
