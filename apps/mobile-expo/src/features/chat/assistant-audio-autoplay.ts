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
const PLAYBACK_STALL_TIMEOUT_MS = 15_000;

async function waitForCaptureRelease(): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isAudioCaptureActive()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isAudioCaptureActive();
}

export async function playAssistantAudioTrack(
  item: AssistantAudioAutoplayItem,
  stallTimeoutMs = PLAYBACK_STALL_TIMEOUT_MS,
): Promise<AssistantAudioAutoplayResult> {
  if (!await waitForCaptureRelease()) return 'interrupted';
  const cache = isMediaUri(item.uri) ? new MessageAudioCache() : null;
  const playback: { player: AudioPlayer | null } = { player: null };
  let settled = false;
  let listener: { remove(): void } | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  try {
    const playbackUri = cache
      ? await cache.download(buildGatewayMediaReadPath(item.uri, item.conversationId), item.mimeType)
      : item.uri;
    if (isAudioCaptureActive()) return 'interrupted';
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });

    return await new Promise<AssistantAudioAutoplayResult>((resolve, reject) => {
      const finish = (result: AssistantAudioAutoplayResult, error?: unknown) => {
        if (settled) return;
        settled = true;
        if (watchdog) clearTimeout(watchdog);
        listener?.remove();
        releaseAudioPlayback(AUTOPLAY_OWNER);
        try { playback.player?.remove(); } catch { /* The player may already be released. */ }
        playback.player = null;
        if (error) reject(error);
        else resolve(result);
      };
      const armWatchdog = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(
          () => finish('completed', new Error('Assistant audio playback stalled')),
          stallTimeoutMs,
        );
      };

      try {
        playback.player = createAudioPlayer(playbackUri, { updateInterval: 250 });
        let lastPosition = -1;
        listener = playback.player.addListener('playbackStatusUpdate', (status) => {
          if (status.error) finish('completed', new Error(status.error));
          else if (status.didJustFinish) finish('completed');
          else if (status.playing && status.currentTime > lastPosition) {
            lastPosition = status.currentTime;
            armWatchdog();
          }
        });
        claimAudioPlayback(AUTOPLAY_OWNER, () => finish('interrupted'));
        armWatchdog();
        playback.player.play();
      } catch (error) {
        finish('completed', error);
      }
    });
  } finally {
    cache?.remove();
    if (!settled) {
      if (watchdog) clearTimeout(watchdog);
      listener?.remove();
      releaseAudioPlayback(AUTOPLAY_OWNER);
      try { playback.player?.remove(); } catch { /* Ignore cleanup races. */ }
    }
  }
}

const autoplayQueue = new AssistantAudioAutoplayQueue(async (item) => {
  try {
    return await playAssistantAudioTrack(item);
  } catch (error) {
    console.warn('[AssistantAudioAutoplay] Playback failed', error);
    throw error;
  }
});

/** Plays only newly streamed assistant audio; persisted history remains user-initiated. */
export function queueAssistantAudioAutoplay(audio: AudioContent, conversationId: string): void {
  const uri = audio.uri?.trim();
  if (!uri) return;
  autoplayQueue.enqueue({
    key: `${conversationId}:${uri}`,
    uri,
    mimeType: audio.mimeType,
    conversationId,
  });
}
