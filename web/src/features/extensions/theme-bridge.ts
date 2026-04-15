import type { ThemeInfo } from '@xopcai/extension-ui-sdk';

const THEME_TOKEN_NAMES = [
  '--color-surface-base',
  '--color-surface-panel',
  '--color-surface-hover',
  '--color-fg',
  '--color-fg-muted',
  '--color-fg-subtle',
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-soft',
  '--color-edge',
  '--color-edge-subtle',
  '--color-danger',
  '--color-success',
  '--color-warning',
  '--radius-sm',
  '--radius-lg',
  '--radius-xl',
];

export function buildThemeInfo(mode: 'light' | 'dark'): ThemeInfo {
  const computedStyle = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = {};
  for (const name of THEME_TOKEN_NAMES) {
    const value = computedStyle.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  }
  return {
    mode,
    tokens,
    fontFamily: computedStyle.getPropertyValue('font-family').trim(),
    fontFamilyMono: computedStyle.getPropertyValue('--font-mono').trim(),
  };
}
