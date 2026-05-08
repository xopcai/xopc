/**
 * STT/TTS settings aligned with the gateway config payload.
 *
 * Wire format: the gateway exposes `stt` (mapped from `tools.media.audio`) and
 * `tts` (mapped from `messages.tts`) for backwards-friendly REST shape; this
 * file mirrors those keys 1:1.
 *
 * Provider id for TTS is intentionally an open `string` so extension-registered
 * SpeechProviderPlugins (e.g. `tts-local-cli`) appear in the dropdown without
 * a type bump.
 */

export interface VoiceModel {
  id: string;
  name: string;
  description?: string;
}

export interface VoiceModelsPayload {
  stt: {
    alibaba: VoiceModel[];
    openai: VoiceModel[];
  };
  tts: {
    alibaba: VoiceModel[];
    openai: VoiceModel[];
    edge: VoiceModel[];
    minimax: VoiceModel[];
  };
  ttsVoices: {
    alibaba: VoiceModel[];
    openai: VoiceModel[];
    edge: VoiceModel[];
    minimax: VoiceModel[];
  };
}

export interface SttSettings {
  enabled: boolean;
  provider: 'alibaba' | 'openai';
  alibaba?: { apiKey?: string; model?: string };
  openai?: { apiKey?: string; model?: string };
  fallback?: { enabled: boolean; order: ('alibaba' | 'openai')[] };
}

/** Built-in TTS provider ids; extensions add more via the SpeechProviderRegistry. */
export type BuiltinTtsProvider = 'openai' | 'alibaba' | 'edge' | 'minimax' | 'tts-local-cli';

/** Local CLI provider config (matches `extensions/tts-local-cli/xopc.extension.json`). */
export interface TtsLocalCliSettings {
  /** Shell command template, e.g. `mlx_audio.tts.generate --text "{{Text}}" --file_prefix {{OutputBase}}`. */
  command?: string;
  /** Extra args appended after the parsed command. */
  args?: string[];
  /** Optional working directory for the spawned process. */
  cwd?: string;
  /** Output extension produced by the CLI (`mp3` | `opus` | `wav`). Defaults to `wav`. */
  outputFormat?: 'mp3' | 'opus' | 'wav';
  /** Per-call timeout override in ms (defaults to TTS root `timeoutMs`, hard-kill at 120000). */
  timeoutMs?: number;
  /** Extra env vars merged into the spawned process env. */
  env?: Record<string, string>;
}

export interface TtsSettings {
  enabled: boolean;
  /** Built-in id or any extension-registered SpeechProviderPlugin id. */
  provider: string;
  trigger: 'off' | 'always' | 'inbound' | 'tagged';
  maxTextLength?: number;
  timeoutMs?: number;
  alibaba?: { apiKey?: string; model?: string; voice?: string };
  openai?: { apiKey?: string; baseUrl?: string; model?: string; voice?: string };
  edge?: { voice?: string; lang?: string };
  minimax?: { apiKey?: string; baseUrl?: string; model?: string; voice?: string; groupId?: string };
  'tts-local-cli'?: TtsLocalCliSettings;
}

export interface VoiceSettingsState {
  stt: SttSettings;
  tts: TtsSettings;
}
