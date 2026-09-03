import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memory, appearance, getLocales } = vi.hoisted(() => {
  const state = {
    scheme: 'light' as 'light' | 'dark',
  };
  return {
    memory: new Map<string, string>(),
    getLocales: vi.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
    appearance: {
      state,
      setColorScheme: vi.fn(),
      getColorScheme: vi.fn(() => state.scheme),
      addChangeListener: vi.fn(() => ({ remove: vi.fn() })),
    },
  };
});

vi.mock('expo-localization', () => ({ getLocales }));

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
    getLocales.mockReset().mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
  });

  it.each(['zh-CN', 'zh-Hans-CN', 'zh-Hant-TW'])('starts in Chinese for %s and saves the initial language', (languageTag) => {
    getLocales.mockReturnValue([{ languageCode: 'zh', languageTag }]);
    usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().language).toBe('zh');
    expect(memory.get(KEYS.language)).toBe('zh');

    getLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().language).toBe('zh');
  });

  it.each(['en', 'zh'] as const)('preserves a manual %s selection on the next startup', (language) => {
    usePreferencesStore.getState().setLanguage(language);
    getLocales.mockReturnValue([{ languageCode: language === 'en' ? 'zh' : 'en', languageTag: language === 'en' ? 'zh-CN' : 'en-US' }]);
    usePreferencesStore.setState({ language: language === 'en' ? 'zh' : 'en' });
    usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().language).toBe(language);
    expect(getLocales).not.toHaveBeenCalled();
  });

  it('uses English when the first preferred language is unsupported', () => {
    getLocales.mockReturnValue([{ languageCode: 'fr', languageTag: 'fr-FR' }, { languageCode: 'zh', languageTag: 'zh-CN' }]);
    usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().language).toBe('en');
  });

  it('falls back to English when device language settings are unavailable', () => {
    getLocales.mockImplementation(() => { throw new Error('Locales unavailable'); });
    usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().language).toBe('en');
  });

  it('leaves clipboard intake off until the user opts in', () => {
    expect(usePreferencesStore.getState().hydrated).toBe(false);

    usePreferencesStore.getState().hydrate();

    expect(usePreferencesStore.getState().hydrated).toBe(true);
    expect(usePreferencesStore.getState().clipboardIntakeEnabled).toBe(false);
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
