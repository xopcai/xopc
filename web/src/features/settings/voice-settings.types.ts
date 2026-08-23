/**
 * STT/TTS settings aligned with the gateway config payload.
 *
 * Wire format: the gateway exposes `stt` (mapped from `tools.media.audio`) and
 * `tts` (mapped from `messages.tts`). This file mirrors those keys 1:1.
 *
 * Provider id for TTS is intentionally an open `string` so extension-registered
 * SpeechProviderPlugins (e.g. `tts-local-cli`) appear in the dropdown without
 * a type bump.
 */

export interface VoiceModel {
  id: string;
  name: string;
  description?: string;
  tts?: {
    speed: boolean;
    instructions: boolean;
    outputFormats: string[];
    defaultVoice?: string;
  };
}

export interface VoiceModelsPayload {
  stt: Record<string, VoiceModel[]>;
  tts: Record<string, VoiceModel[]>;
  ttsVoices: Record<string, VoiceModel[]>;
}

export type VoiceConfigFieldType = 'string' | 'password' | 'number' | 'boolean' | 'select' | 'textarea';

export interface VoiceConfigFieldMetadata {
  key: string;
  label: string;
  type: VoiceConfigFieldType;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  description?: string;
  options?: VoiceModel[];
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface VoiceProviderDiagnosticMetadata {
  requiresApiKey: boolean;
  envKeys?: string[];
  configPath: string;
}

export interface VoiceProviderMetadata {
  id: string;
  capability: 'stt' | 'tts';
  displayName: string;
  description?: string;
  aliases?: string[];
  models?: VoiceModel[];
  voices?: VoiceModel[];
  fields: VoiceConfigFieldMetadata[];
  diagnostics: VoiceProviderDiagnosticMetadata;
}

export interface SttSettings {
  enabled: boolean;
  /** Built-in id or any extension-registered MediaUnderstandingProvider id. */
  provider: string;
  alibaba?: { apiKey?: string; model?: string };
  openai?: { apiKey?: string; model?: string };
  providers?: Record<string, Record<string, unknown>>;
  fallback?: { enabled: boolean; order: string[] };
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
  providers?: Record<string, Record<string, unknown>>;
  alibaba?: { apiKey?: string; model?: string; voice?: string };
  openai?: { apiKey?: string; baseUrl?: string; model?: string; voice?: string };
  edge?: { voice?: string; lang?: string };
  minimax?: { apiKey?: string; baseUrl?: string; model?: string; voice?: string; groupId?: string };
  'tts-local-cli'?: TtsLocalCliSettings;
}

export interface VoiceSettingsState {
  stt: SttSettings;
  tts: TtsSettings;
  voice: {
    languageMode: 'auto' | 'manual';
    language: 'en' | 'zh';
    input: {
      refinement: {
        mode: 'off' | 'punctuation' | 'light' | 'custom';
        model?: string;
        customInstruction?: string;
      };
    };
  };
}

export interface TtsProviderListEntry extends VoiceProviderMetadata {
  aliases: string[];
  configured: boolean;
}

export interface VoiceProvidersPayload {
  providers: TtsProviderListEntry[];
  active: string;
}

export interface SttProviderListEntry extends VoiceProviderMetadata {
  aliases: string[];
  configured: boolean;
}

export interface SttProvidersPayload {
  providers: SttProviderListEntry[];
  active: string;
}
