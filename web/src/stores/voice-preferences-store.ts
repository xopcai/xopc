import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface VoicePreferences {
  captions: boolean;
  microphoneId: string;
  setCaptions: (value: boolean) => void;
  setMicrophoneId: (value: string) => void;
}

/** Device and display preferences stay on this browser, never in gateway config. */
export const useVoicePreferencesStore = create<VoicePreferences>()(persist((set) => ({
  captions: true,
  microphoneId: '',
  setCaptions: (captions) => set({ captions }),
  setMicrophoneId: (microphoneId) => set({ microphoneId }),
}), { name: 'xopc-voice-preferences' }));

export function voiceInputConstraints(): MediaTrackConstraints {
  const microphoneId = useVoicePreferencesStore.getState().microphoneId;
  return {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}),
  };
}
