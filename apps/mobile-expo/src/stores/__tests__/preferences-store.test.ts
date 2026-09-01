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
    newSessionPreferencesByGateway: 'prefs.newSessionPreferencesByGateway',
    notificationsEnabled: 'prefs.notificationsEnabled',
    autoReadAloudEnabled: 'prefs.autoReadAloudEnabled',
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
    newSessionPreferencesByGateway: {},
    clipboardIntakeEnabled: true,
    notificationsEnabled: false,
    autoReadAloudEnabled: false,
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

  it('keeps notifications opt-in and persists the local intent', () => {
    usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().notificationsEnabled).toBe(false);
    expect(memory.has(KEYS.notificationsEnabled)).toBe(false);

    usePreferencesStore.getState().setNotificationsEnabled(true);
    expect(memory.get(KEYS.notificationsEnabled)).toBe('true');

    usePreferencesStore.setState({ notificationsEnabled: false });
    usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().notificationsEnabled).toBe(true);
  });

  it('persists automatic read aloud as an opt-in preference', () => {
    usePreferencesStore.getState().setAutoReadAloudEnabled(true);

    expect(memory.get(KEYS.autoReadAloudEnabled)).toBe('true');

    usePreferencesStore.setState({ autoReadAloudEnabled: false });
    usePreferencesStore.getState().hydrate();

    expect(usePreferencesStore.getState().autoReadAloudEnabled).toBe(true);
  });

  it('keeps new-session model and project preferences isolated by gateway and agent', () => {
    const store = usePreferencesStore.getState();
    store.rememberSelectedAgent('gateway-a', 'Coder');
    store.rememberAgentModel('gateway-a', 'Coder', {
      modelRef: 'openai/gpt-test',
      thinkingLevel: 'high',
    });
    store.rememberLastChatScope('gateway-a', 'project-1');
    store.rememberAgentModel('gateway-b', 'main', { modelRef: 'local/model' });

    const preferences = usePreferencesStore.getState().newSessionPreferencesByGateway;
    expect(preferences['gateway-a']).toMatchObject({
      selectedAgentId: 'coder',
      modelByAgent: {
        coder: { modelRef: 'openai/gpt-test', thinkingLevel: 'high' },
      },
      lastChatScope: { kind: 'project', projectId: 'project-1' },
    });
    expect(preferences['gateway-b']?.modelByAgent.main?.modelRef).toBe('local/model');
    expect(memory.get(KEYS.newSessionPreferencesByGateway)).toContain('openai/gpt-test');
  });
});
