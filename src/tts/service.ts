import type { TTSConfig, TTSAutoMode, TTSResult } from './types.js';

const CHANNEL_OUTPUT_FORMATS: Record<string, { format: string; voiceCompatible: boolean }> = {
  telegram: { format: 'opus', voiceCompatible: true },
  feishu: { format: 'opus', voiceCompatible: true },
  whatsapp: { format: 'ogg', voiceCompatible: true },
  /** Web UI: MP3 plays in all major browsers without extra codecs. */
  webchat: { format: 'mp3', voiceCompatible: false },
  default: { format: 'mp3', voiceCompatible: false },
};

export function getChannelOutputFormat(channel?: string): { format: string; voiceCompatible: boolean } {
  if (!channel) return CHANNEL_OUTPUT_FORMATS.default;
  return CHANNEL_OUTPUT_FORMATS[channel.toLowerCase()] || CHANNEL_OUTPUT_FORMATS.default;
}

export interface TTSContext {
  channel?: string;
  chatId?: string;
}

export interface TTSDecision {
  useTTS: boolean;
  reason: string;
}

export function shouldUseTTS(config: TTSConfig | undefined, inboundAudio?: boolean): TTSDecision {
  if (!config?.enabled) {
    return { useTTS: false, reason: 'TTS disabled' };
  }

  const triggerRaw = (config.trigger ?? 'off') as string;
  const trigger = triggerRaw === 'auto' ? 'inbound' : triggerRaw;

  switch (trigger) {
    case 'off':
      return { useTTS: false, reason: 'trigger=off' };
    case 'always':
      return { useTTS: true, reason: 'trigger=always' };
    case 'inbound':
      return inboundAudio === true
        ? { useTTS: true, reason: 'trigger=inbound + inboundAudio=true' }
        : { useTTS: false, reason: 'trigger=inbound but no inbound audio' };
    case 'tagged':
      return { useTTS: false, reason: 'trigger=tagged (directive check in TTS module)' };
    default:
      return { useTTS: false, reason: `unknown trigger=${trigger}` };
  }
}

export class TTSService {
  constructor(private config: TTSConfig) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getTriggerMode(): TTSAutoMode {
    return this.config.trigger;
  }

  async speak(text: string, context?: TTSContext): Promise<TTSResult> {
    const { speak } = await import('./index.js');
    return speak(text, this.config, {
      tts: {
        format: getChannelOutputFormat(context?.channel).format as 'opus' | 'mp3' | 'wav',
      },
    });
  }
}
