import type { Config } from '../../config/schema.js';
import { persistOutboundTtsAudio } from '../../channels/attachments/outbound-tts-persist.js';
import type { MediaRef } from '../../media/types.js';
import { compressAudio } from '../../voice/tts/audio.js';
import { speak } from '../../voice/tts/index.js';
import { mergeTtsConfigFromAppConfig } from '../../voice/tts/merge-config.js';
import { shouldUseTTS, getChannelOutputFormat } from '../../voice/tts/service.js';
import { isTTSAvailable } from '../../voice/tts/factory.js';
import type { SessionStore } from '../../session/index.js';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

export type WebchatTtsResult = {
  type: 'tts_audio';
  uri: string;
  mimeType: string;
  name: string;
};

export type WebchatTtsDeps = {
  config: Config | undefined;
  sessionStore: SessionStore;
  getLastAssistantPlainText: (sessionKey: string) => string;
  log: { warn: (obj: Record<string, unknown>, msg: string) => void };
};

/**
 * Generate TTS for webchat when config allows; persist under `{stateDir}/media/tts/`.
 */
export async function maybeEmitWebchatTts(
  deps: WebchatTtsDeps,
  sessionKey: string,
  hadInboundVoice: boolean,
): Promise<WebchatTtsResult | null> {
  const ttsConfig = mergeTtsConfigFromAppConfig(deps.config?.messages?.tts);
  if (!isTTSAvailable(ttsConfig)) {
    return null;
  }
  const decision = shouldUseTTS(ttsConfig, hadInboundVoice);
  if (!decision.useTTS) {
    return null;
  }
  const text = deps.getLastAssistantPlainText(sessionKey).trim();
  if (!text) {
    return null;
  }
  try {
    const webOut = getChannelOutputFormat('webchat');
    const fmt = webOut.format as 'opus' | 'mp3' | 'wav';
    const ttsResult = await speak(text, ttsConfig, {
      appConfig: deps.config,
      tts: { format: fmt },
    });
    const { buffer, format } = await compressAudio(
      Buffer.from(ttsResult.audio),
      ttsResult.format,
      webOut.format === 'mp3' ? 'mp3' : 'opus',
    );
    const normalizedMime =
      format === 'opus' || format === 'ogg'
        ? 'audio/ogg'
        : format === 'mp3' || format === 'mpeg'
          ? 'audio/mpeg'
          : format === 'wav'
            ? 'audio/wav'
            : `audio/${format}`;
    const persisted = await persistOutboundTtsAudio(buffer, format);
    await appendMediaToLastAssistant(deps.sessionStore, sessionKey, persisted);
    return {
      type: 'tts_audio',
      uri: persisted.uri,
      mimeType: normalizedMime,
      name: persisted.name,
    };
  } catch (err) {
    deps.log.warn({ err, sessionKey }, 'Webchat TTS failed');
    return null;
  }
}

export async function appendMediaToLastAssistant(
  sessionStore: SessionStore,
  sessionKey: string,
  ref: MediaRef,
): Promise<void> {
  const loaded = await sessionStore.load(sessionKey);
  for (let i = loaded.length - 1; i >= 0; i--) {
    const m = loaded[i] as { role?: string; media?: MediaRef[] };
    if (m.role === 'assistant') {
      const prev = m.media ?? [];
      if (prev.some((x) => x.uri === ref.uri)) {
        return;
      }
      loaded[i] = { ...m, media: [...prev, ref] } as unknown as AgentMessage;
      await sessionStore.saveMessages(sessionKey, loaded);
      return;
    }
  }
}
