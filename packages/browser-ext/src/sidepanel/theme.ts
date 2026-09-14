export type SidePanelTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'xopc.sidepanel.theme';

export function isSidePanelTheme(value: unknown): value is SidePanelTheme {
  return value === 'light' || value === 'dark';
}

export function applySidePanelTheme(theme: SidePanelTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export async function loadSidePanelThemePreference(): Promise<SidePanelTheme> {
  const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
  const theme = isSidePanelTheme(stored[THEME_STORAGE_KEY])
    ? stored[THEME_STORAGE_KEY]
    : globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applySidePanelTheme(theme);
  return theme;
}

export async function saveSidePanelThemePreference(theme: SidePanelTheme): Promise<void> {
  await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
  applySidePanelTheme(theme);
}
