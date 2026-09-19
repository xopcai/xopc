import type { Config } from '../../config/schema.js';
import { persistOutboundTtsAudio } from '../../channels/attachments/outbound-tts-persist.js';
import { deleteMediaUris } from '../../media/session-references.js';
import type { MediaRef } from '../../media/types.js';
import {
  appendMediaToAssistantTranscriptEntry,
  findLatestAssistantTranscriptEntryId,
} from '../../storage/sqlite/index.js';
import { compressAudio } from '../../voice/tts/audio.js';
import { speak } from '../../voice/tts/index.js';
import { mergeTtsConfigFromAppConfig } from '../../voice/tts/merge-config.js';
import { shouldUseTTS, getChannelOutputFormat } from '../../voice/tts/service.js';
import { isTTSAvailable } from '../../voice/tts/factory.js';

export type WebchatTtsResult = {
  type: 'tts_audio';
  uri: string;
  mimeType: string;
  name: string;
};

export type WebchatTtsDeps = {
  config: Config | undefined;
  getLastAssistantPlainText: (conversationId: string) => string;
  log: { warn: (obj: Record<string, unknown>, msg: string) => void };
};

/** True when the explicit TTS tool already produced durable Webchat audio. */
export function isSuccessfulWebchatTtsToolEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  const row = event as Record<string, unknown>;
  if (
    row.type !== 'tool_execution_end'
    || row.toolName !== 'text_to_speech'
    || row.isError === true
  ) {
    return false;
  }
  const result = row.result && typeof row.result === 'object' && !Array.isArray(row.result)
    ? row.result as Record<string, unknown>
    : null;
  const details = result?.details && typeof result.details === 'object' && !Array.isArray(result.details)
    ? result.details as Record<string, unknown>
    : null;
  return Array.isArray(details?.media) && details.media.some((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const media = item as Record<string, unknown>;
    return typeof media.uri === 'string' && media.uri.trim().length > 0;
  });
}

/**
 * Generate TTS for webchat when config allows; persist under `{stateDir}/media/tts/`.
 */
export async function maybeEmitWebchatTts(
  deps: WebchatTtsDeps,
  conversationId: string,
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
  const text = deps.getLastAssistantPlainText(conversationId).trim();
  if (!text) {
    return null;
  }
  const assistantEntryId = findLatestAssistantTranscriptEntryId(conversationId);
  if (!assistantEntryId) {
    deps.log.warn({ conversationId }, 'Webchat TTS skipped because the assistant transcript is unavailable');
    return null;
  }
  let persisted: MediaRef | undefined;
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
    persisted = await persistOutboundTtsAudio(buffer, format);
    if (!appendMediaToAssistantTranscriptEntry(conversationId, assistantEntryId, persisted)) {
      await deleteMediaUris([persisted.uri]);
      deps.log.warn(
        { conversationId, assistantEntryId },
        'Webchat TTS discarded because its assistant transcript changed',
      );
      return null;
    }
    return {
      type: 'tts_audio',
      uri: persisted.uri,
      mimeType: normalizedMime,
      name: persisted.name,
    };
  } catch (err) {
    if (persisted) await deleteMediaUris([persisted.uri]);
    deps.log.warn({ err, conversationId }, 'Webchat TTS failed');
    return null;
  }
}
