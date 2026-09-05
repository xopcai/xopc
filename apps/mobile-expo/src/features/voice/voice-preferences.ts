import { create } from 'zustand';
import { storage } from '../../storage/mmkv';

type Preferences = { captions: boolean; background: boolean; engines: Record<string, 'agent' | 'omni'> };
const key = 'voice.preferences';
function read(): Preferences {
  try {
    const value = JSON.parse(storage.getString(key) ?? '{}');
    return { captions: value.captions !== false, background: value.background === true,
      engines: Object.fromEntries(Object.entries(value.engines ?? {}).filter(([, engine]) => engine === 'agent' || engine === 'omni')) as Preferences['engines'] };
  } catch { return { captions: true, background: false, engines: {} }; }
}
export const useVoicePreferences = create<Preferences & { update: (value: Partial<Preferences>) => void }>((set, get) => ({
  ...read(), update(value) {
    const next = { captions: get().captions, background: get().background, engines: get().engines, ...value };
    storage.set(key, JSON.stringify(next));
    set(next);
  },
}));
