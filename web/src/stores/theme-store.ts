import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'system';

function getSystemDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'system') {
    return getSystemDark() ? 'dark' : 'light';
  }
  return pref;
}

function applyDomTheme(mode: 'light' | 'dark') {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.dataset.theme = mode;
}

/** Sync DOM from localStorage before React paint (zustand persist hydrates async). */
export function bootstrapTheme() {
  try {
    const raw = localStorage.getItem('xopcbot-web-theme');
    let pref: ThemePreference = 'system';
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { preference?: ThemePreference } };
      if (parsed.state?.preference) pref = parsed.state.preference;
    }
    applyDomTheme(resolveTheme(pref));
  } catch {
    applyDomTheme(resolveTheme('system'));
  }
}

type ThemeState = {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  resolved: 'light' | 'dark';
};

export const useThemeStore = create(
  persist<ThemeState>(
    (set) => ({
      preference: 'system',
      resolved: resolveTheme('system'),

      setPreference: (preference) => {
        const resolved = resolveTheme(preference);
        applyDomTheme(resolved);
        set({ preference, resolved });
      },
    }),
    {
      name: 'xopcbot-web-theme',
    },
  ),
);

export function syncThemeAfterHydration() {
  const { preference } = useThemeStore.getState();
  const resolved = resolveTheme(preference);
  applyDomTheme(resolved);
  useThemeStore.setState({ resolved });
}

export function subscribeSystemTheme() {
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};

  const handler = () => {
    const { preference } = useThemeStore.getState();
    if (preference !== 'system') return;
    const resolved = resolveTheme('system');
    applyDomTheme(resolved);
    useThemeStore.setState({ resolved });
  };

  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
