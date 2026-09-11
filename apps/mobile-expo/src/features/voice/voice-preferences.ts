import { create } from 'zustand';
import { storage } from '../../storage/mmkv';

type Preferences = { captions: boolean; background: boolean; modes: Record<string, 'natural' | 'assistant'> };
const key = 'voice.preferences';
function read(): Preferences {
  try {
    const value = JSON.parse(storage.getString(key) ?? '{}');
    return { captions: value.captions !== false, background: value.background === true,
      modes: Object.fromEntries(Object.entries(value.modes ?? {}).filter(([, mode]) => mode === 'natural' || mode === 'assistant')) as Preferences['modes'] };
  } catch { return { captions: true, background: false, modes: {} }; }
}
export const useVoicePreferences = create<Preferences & { update: (value: Partial<Preferences>) => void }>((set, get) => ({
  ...read(), update(value) {
    const next = { captions: get().captions, background: get().background, modes: get().modes, ...value };
    storage.set(key, JSON.stringify(next));
    set(next);
  },
}));
