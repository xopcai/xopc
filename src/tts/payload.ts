import type { OutboundMessage } from '../channels/transport-types.js';
import type { TTSConfig, TTSAutoMode } from './types.js';
import { shouldUseTTS, getChannelOutputFormat } from './service.js';
import { speak } from './index.js';
import { compressAudio } from './audio.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TTS/Payload');

export interface TTSApplyOptions {
  config: TTSConfig | undefined;
  channel: string;
  inboundAudio: boolean;
}

export async function maybeApplyTtsToPayload(
  msg: OutboundMessage,
  options: TTSApplyOptions
): Promise<OutboundMessage> {
  const { config, channel, inboundAudio } = options;

  if (!msg.content?.trim()) return msg;
  if (msg.mediaUrl) return msg;

  const ttsDecision = shouldUseTTS(config, inboundAudio);
  if (!ttsDecision.useTTS) {
    log.debug({ reason: ttsDecision.reason }, 'TTS skipped');
    return msg;
  }

  const trigger = config?.trigger || 'off';
  if (trigger === 'off') return msg;

  if (trigger === 'tagged') {
    const hasTtsDirective = /\[\[tts\]\]/i.test(msg.content);
    if (!hasTtsDirective) return msg;
    msg = {
      ...msg,
      content: msg.content.replace(/\[\[tts\]\]/gi, '').trim(),
    };
  }

  try {
    const outFmt = getChannelOutputFormat(channel);
    const ttsResult = await speak(msg.content, config, {
      tts: {
        format: outFmt.format as 'opus' | 'mp3' | 'wav',
      },
    });

    const wavTarget = outFmt.format === 'mp3' ? 'mp3' : 'opus';
    const { buffer: compressedAudio, format: compressedFormat } = await compressAudio(
      Buffer.from(ttsResult.audio),
      ttsResult.format,
      wavTarget,
    );

    const mimeType =
      compressedFormat === 'opus'
        ? 'audio/ogg'
        : compressedFormat === 'mp3' || compressedFormat === 'mpeg'
          ? 'audio/mpeg'
          : `audio/${compressedFormat}`;
    const base64 = compressedAudio.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    log.info({ channel, provider: ttsResult.provider, format: compressedFormat }, 'TTS generated');

    return {
      ...msg,
      mediaUrl: dataUrl,
      mediaType: 'audio',
      audioAsVoice: outFmt.voiceCompatible,
    };
  } catch (error) {
    log.warn({ error }, 'TTS failed, sending text');
    return msg;
  }
}

export function isTtsEnabled(config: TTSConfig | undefined): boolean {
  if (!config?.enabled) return false;
  return config.trigger !== 'off';
}

export function resolveTtsAutoMode(
  config: TTSConfig | undefined,
  sessionOverride?: string
): TTSAutoMode {
  if (sessionOverride) {
    const normalized = sessionOverride.toLowerCase().trim();
    if (['off', 'always', 'inbound', 'tagged'].includes(normalized)) {
      return normalized as TTSAutoMode;
    }
  }
  if (!config?.enabled) return 'off';
  return config.trigger || 'off';
}
