import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isSidePanelTheme,
  loadSidePanelThemePreference,
  saveSidePanelThemePreference,
} from './theme';

afterEach(() => vi.unstubAllGlobals());

describe('side panel theme preference', () => {
  it('recognizes supported themes', () => {
    expect(isSidePanelTheme('light')).toBe(true);
    expect(isSidePanelTheme('dark')).toBe(true);
    expect(isSidePanelTheme('system')).toBe(false);
  });

  it('loads, applies and persists a selected theme', async () => {
    const get = vi.fn(async () => ({ 'xopc.sidepanel.theme': 'dark' }));
    const set = vi.fn(async () => undefined);
    const documentElement = { dataset: {} as Record<string, string>, style: { colorScheme: '' } };
    vi.stubGlobal('chrome', { storage: { local: { get, set } } });
    vi.stubGlobal('document', { documentElement });

    await expect(loadSidePanelThemePreference()).resolves.toBe('dark');
    expect(documentElement.dataset.theme).toBe('dark');
    expect(documentElement.style.colorScheme).toBe('dark');

    await saveSidePanelThemePreference('light');
    expect(set).toHaveBeenCalledWith({ 'xopc.sidepanel.theme': 'light' });
    expect(documentElement.dataset.theme).toBe('light');
  });
});
