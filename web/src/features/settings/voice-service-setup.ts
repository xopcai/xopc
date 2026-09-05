import type { VoiceSettingsState } from './voice-settings.types';

export function configureRealtimeService(form: VoiceSettingsState, provider: 'alibaba' | 'xopc-cloud'): VoiceSettingsState {
  return {
    ...form,
    stt: { ...form.stt, enabled: true, provider },
    voice: { ...form.voice, realtime: {
      ...form.voice.realtime,
      enabled: true,
      tts: form.voice.realtime.tts?.provider === provider ? form.voice.realtime.tts : { provider, ...(provider === 'alibaba' ? { voice: 'Cherry' } : {}) },
      omni: form.voice.realtime.omni?.provider === provider ? form.voice.realtime.omni : { provider, model: 'qwen3-omni-flash-realtime', voice: form.voice.realtime.omni?.voice ?? 'Cherry', instructions: form.voice.realtime.omni?.instructions ?? 'Keep replies conversational and concise.' },
    } },
  };
}

