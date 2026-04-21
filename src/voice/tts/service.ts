import type { TTSConfig, TTSAutoMode, TTSResultWithTracking } from './types.js';

export interface ChannelAudioFormat {
  format: string;
  voiceCompatible: boolean;
}

/** Per-channel encoding for outbound TTS. Only ids that xopc actually delivers on are listed; anything else uses `default`. */
const CHANNEL_OUTPUT_FORMATS: Record<string, ChannelAudioFormat> = {
  telegram: { format: 'opus', voiceCompatible: true },
  /** Weixin ilink: VoiceItem encode_type 7 = MP3 per API types. */
  weixin: { format: 'mp3', voiceCompatible: true },
  webchat: { format: 'mp3', voiceCompatible: false },
  cli: { format: 'mp3', voiceCompatible: false },
  default: { format: 'mp3', voiceCompatible: false },
};

export function getChannelOutputFormat(channel?: string): ChannelAudioFormat {
  if (!channel) return CHANNEL_OUTPUT_FORMATS.default;
  return CHANNEL_OUTPUT_FORMATS[channel.toLowerCase()] || CHANNEL_OUTPUT_FORMATS.default;
}

export function getSupportedChannels(): string[] {
  return Object.keys(CHANNEL_OUTPUT_FORMATS).filter((k) => k !== 'default');
}

export function isVoiceCompatibleChannel(channel: string): boolean {
  return getChannelOutputFormat(channel).voiceCompatible;
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

  async speak(text: string, context?: TTSContext): Promise<TTSResultWithTracking> {
    const { speak } = await import('./index.js');
    return speak(text, this.config, {
      tts: {
        format: getChannelOutputFormat(context?.channel).format as 'opus' | 'mp3' | 'wav',
      },
    });
  }
}
