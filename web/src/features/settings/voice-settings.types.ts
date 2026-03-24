/** STT/TTS settings aligned with gateway config and `ui/src/components/VoiceConfigSection.ts`. */

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
  };
  ttsVoices: {
    alibaba: VoiceModel[];
    openai: VoiceModel[];
    edge: VoiceModel[];
  };
}

export interface SttSettings {
  enabled: boolean;
  provider: 'alibaba' | 'openai';
  alibaba?: { apiKey?: string; model?: string };
  openai?: { apiKey?: string; model?: string };
  fallback?: { enabled: boolean; order: ('alibaba' | 'openai')[] };
}

export interface TtsSettings {
  enabled: boolean;
  provider: 'openai' | 'alibaba' | 'edge';
  trigger: 'off' | 'always' | 'inbound' | 'tagged';
  maxTextLength?: number;
  timeoutMs?: number;
  alibaba?: { apiKey?: string; model?: string; voice?: string };
  openai?: { apiKey?: string; model?: string; voice?: string };
  edge?: { voice?: string; lang?: string };
}

export interface VoiceSettingsState {
  stt: SttSettings;
  tts: TtsSettings;
}
