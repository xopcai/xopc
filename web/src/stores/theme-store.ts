import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'system';

/** Visual color scheme — orthogonal to light/dark mode. */
export type ColorScheme = 'default' | 'emerald';

export const COLOR_SCHEMES: { value: ColorScheme; labelEn: string; labelZh: string }[] = [
  { value: 'default', labelEn: 'Default', labelZh: '默认' },
  { value: 'emerald', labelEn: 'Light green', labelZh: '浅绿' },
];

const DEFAULT_COLOR_SCHEME: ColorScheme = 'default';

const THEME_META_COLOR: Record<'light' | 'dark', Record<ColorScheme, string>> = {
  light: {
    default: '#f5f5f7',
    emerald: '#f0fdf4',
  },
  dark: {
    default: '#1c1c1e',
    emerald: '#000000',
  },
};

function syncThemeColorMeta(mode: 'light' | 'dark', scheme: ColorScheme) {
  const head = document.head;
  if (!head) return;
  const selector = 'meta[name="theme-color"][data-xopc-theme-color="true"]';
  let meta = head.querySelector<HTMLMetaElement>(selector);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('data-xopc-theme-color', 'true');
    head.appendChild(meta);
  }
  meta.setAttribute('content', THEME_META_COLOR[mode][scheme]);
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

function normalizeColorScheme(value: unknown): ColorScheme {
  return value === 'default' || value === 'emerald' ? value : DEFAULT_COLOR_SCHEME;
}

/** Apply light/dark + color scheme on `<html>`. Uses View Transitions when available for a softer cross-fade. */
function applyDomTheme(mode: 'light' | 'dark', scheme: ColorScheme, useViewTransition: boolean) {
  const root = document.documentElement;
  const run = () => {
    root.classList.toggle('dark', mode === 'dark');
    root.dataset.theme = mode;
    root.dataset.colorScheme = scheme;
    syncThemeColorMeta(mode, scheme);
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
    const raw = localStorage.getItem('xopc-web-theme');
    let pref: ThemePreference = 'system';
    let scheme: ColorScheme = DEFAULT_COLOR_SCHEME;
    if (raw) {
      const parsed = JSON.parse(raw) as {
        state?: { preference?: ThemePreference; colorScheme?: ColorScheme };
      };
      if (parsed.state?.preference) pref = parsed.state.preference;
      if (parsed.state && 'colorScheme' in parsed.state) {
        scheme = normalizeColorScheme(parsed.state.colorScheme);
      }
    }
    applyDomTheme(resolveTheme(pref), scheme, false);
  } catch {
    applyDomTheme(resolveTheme('system'), 'default', false);
  }
}

type ThemeState = {
  preference: ThemePreference;
  colorScheme: ColorScheme;
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
  setColorScheme: (scheme: ColorScheme) => void;
};

export const useThemeStore = create(
  persist<ThemeState>(
    (set, get) => ({
      preference: 'system',
      colorScheme: DEFAULT_COLOR_SCHEME,
      resolved: resolveTheme('system'),

      setPreference: (preference) => {
        const resolved = resolveTheme(preference);
        const { resolved: prevResolved, colorScheme } = get();
        applyDomTheme(resolved, colorScheme, resolved !== prevResolved);
        set({ preference, resolved });
      },

      setColorScheme: (scheme) => {
        const { resolved } = get();
        applyDomTheme(resolved, scheme, true);
        set({ colorScheme: scheme });
      },
    }),
    {
      name: 'xopc-web-theme',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ThemeState>;
        return {
          ...current,
          ...p,
          colorScheme: normalizeColorScheme(p.colorScheme),
        };
      },
    },
  ),
);

export function syncThemeAfterHydration() {
  const { preference, colorScheme } = useThemeStore.getState();
  const resolved = resolveTheme(preference);
  applyDomTheme(resolved, colorScheme, false);
  useThemeStore.setState({ resolved });
}

export function subscribeSystemTheme() {
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};

  const handler = () => {
    const { preference, colorScheme } = useThemeStore.getState();
    if (preference !== 'system') return;
    const resolved = resolveTheme('system');
    const prevResolved = useThemeStore.getState().resolved;
    applyDomTheme(resolved, colorScheme, resolved !== prevResolved);
    useThemeStore.setState({ resolved });
  };

  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
