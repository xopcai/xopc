import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memory, appearance } = vi.hoisted(() => {
  const state = {
    scheme: 'light' as 'light' | 'dark',
  };
  return {
    memory: new Map<string, string>(),
    appearance: {
      state,
      setColorScheme: vi.fn(),
      getColorScheme: vi.fn(() => state.scheme),
      addChangeListener: vi.fn(() => ({ remove: vi.fn() })),
    },
  };
});

vi.mock('react-native', () => ({
  Appearance: appearance,
  Platform: { OS: 'ios' },
}));

vi.mock('../../storage/mmkv', () => ({
  KEYS: {
    language: 'prefs.language',
    themePreference: 'prefs.themePreference',
    clipboardIntakeEnabled: 'prefs.clipboardIntakeEnabled',
    defaultAgentId: 'prefs.defaultAgentId',
    selectedModelRef: 'prefs.selectedModelRef',
  },
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => {
      memory.set(key, String(value));
    },
    delete: (key: string) => {
      memory.delete(key);
    },
  },
}));

import { KEYS } from '../../storage/mmkv';
import { usePreferencesStore } from '../preferences-store';

function resetStore(): void {
  memory.clear();
  appearance.state.scheme = 'light';
  usePreferencesStore.setState({
    hydrated: false,
    language: 'en',
    themePreference: 'system',
    resolvedTheme: 'light',
    defaultAgentId: null,
    selectedModelRef: null,
    clipboardIntakeEnabled: true,
  });
}

describe('usePreferencesStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('enables clipboard intake by default', () => {
    expect(usePreferencesStore.getState().hydrated).toBe(false);

    usePreferencesStore.getState().hydrate();

    expect(usePreferencesStore.getState().hydrated).toBe(true);
    expect(usePreferencesStore.getState().clipboardIntakeEnabled).toBe(true);
  });

  it('persists clipboard intake opt-out', () => {
    usePreferencesStore.getState().setClipboardIntakeEnabled(false);

    expect(memory.get(KEYS.clipboardIntakeEnabled)).toBe('false');

    usePreferencesStore.setState({ clipboardIntakeEnabled: true });
    usePreferencesStore.getState().hydrate();

    expect(usePreferencesStore.getState().hydrated).toBe(true);
    expect(usePreferencesStore.getState().clipboardIntakeEnabled).toBe(false);
  });
});
