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
  providers?: Record<string, Record<string, unknown>>;
  fallback?: { enabled: boolean; order: string[] };
}

export interface TtsSettings {
  enabled: boolean;
  /** Built-in id or any extension-registered SpeechProviderPlugin id. */
  provider: string;
  trigger: 'off' | 'always' | 'inbound' | 'tagged';
  maxTextLength?: number;
  timeoutMs?: number;
  providers?: Record<string, Record<string, unknown>>;
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
    realtime: {
      enabled: boolean;
      defaultEngine: 'agent' | 'omni';
      silenceDurationMs: number;
      idleTimeoutMs: number;
      maxDictationMs: number;
      maxConversationMs: number;
      bargeIn: boolean;
      tts?: { provider: 'alibaba' | 'xopc-cloud'; voice?: string };
      omni?: {
        provider: 'alibaba' | 'xopc-cloud';
        model: string;
        voice: string;
        apiKey?: string;
        baseUrl?: string;
        instructions: string;
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
