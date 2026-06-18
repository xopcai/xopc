import { describe, expect, it } from 'vitest';

import { applyThemeById, getThinkingBorderColor, resolveThemePalette } from '../theme-manager.js';
import { DEFAULT_TUI_SETTINGS } from '../tui-settings.js';

describe('resolveThemePalette', () => {
  it('resolves auto using XOPC_THEME hint', () => {
    const dark = resolveThemePalette('auto', { XOPC_THEME: 'dark' });
    expect(dark.resolvedId).toBe('dark');
    const light = resolveThemePalette('auto', { XOPC_THEME: 'light' });
    expect(light.resolvedId).toBe('light');
  });

  it('applies thinking border colors by level', () => {
    applyThemeById('dark');
    expect(typeof getThinkingBorderColor('high')).toBe('function');
    expect(getThinkingBorderColor('high')('─')).toContain('─');
  });
});

describe('tui settings', () => {
  it('defines expected defaults', () => {
    expect(DEFAULT_TUI_SETTINGS).toMatchObject({
      theme: 'auto',
      showThinking: false,
      toolsExpanded: false,
      doubleEscapeAction: 'none',
      followUpMode: 'one-at-a-time',
      steeringMode: 'one-at-a-time',
      treeFilterMode: 'default',
      showTerminalProgress: false,
      showStartupHints: true,
    });
  });
});
