import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_META_COLOR = {
  light: '#f5f5f7',
  dark: '#1c1c1e',
} as const;

function syncThemeColorMeta(mode: 'light' | 'dark') {
  const head = document.head;
  if (!head) return;
  const selector = 'meta[name="theme-color"][data-xopcbot-theme-color="true"]';
  let meta = head.querySelector<HTMLMetaElement>(selector);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('data-xopcbot-theme-color', 'true');
    head.appendChild(meta);
  }
  meta.setAttribute('content', THEME_META_COLOR[mode]);
}

function getSystemDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'system') {
    return getSystemDark() ? 'dark' : 'light';
  }
  return pref;
}

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Apply light/dark on `<html>`. Uses View Transitions when available for a softer cross-fade (not instant snap). */
function applyDomTheme(mode: 'light' | 'dark', useViewTransition: boolean) {
  const root = document.documentElement;
  const run = () => {
    root.classList.toggle('dark', mode === 'dark');
    root.dataset.theme = mode;
    syncThemeColorMeta(mode);
  };

  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };

  if (
    useViewTransition &&
    !prefersReducedMotion() &&
    typeof doc.startViewTransition === 'function'
  ) {
    doc.startViewTransition(run);
  } else {
    run();
  }
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
    applyDomTheme(resolveTheme(pref), false);
  } catch {
    applyDomTheme(resolveTheme('system'), false);
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
        const prevResolved = useThemeStore.getState().resolved;
        applyDomTheme(resolved, resolved !== prevResolved);
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
  applyDomTheme(resolved, false);
  useThemeStore.setState({ resolved });
}

export function subscribeSystemTheme() {
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};

  const handler = () => {
    const { preference } = useThemeStore.getState();
    if (preference !== 'system') return;
    const resolved = resolveTheme('system');
    const prevResolved = useThemeStore.getState().resolved;
    applyDomTheme(resolved, resolved !== prevResolved);
    useThemeStore.setState({ resolved });
  };

  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
