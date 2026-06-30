import { describe, expect, it } from 'vitest';

import {
  BROWSER_TABS,
  LEGACY_BROWSER_FOCUS_TO_TAB,
  parseBrowserTab,
  browserTabToBackend,
} from '@/features/settings/browser/panels/browser-tabs';

describe('browser-tabs', () => {
  it('defaults to overview', () => {
    expect(parseBrowserTab(null)).toBe('overview');
    expect(parseBrowserTab('')).toBe('overview');
    expect(parseBrowserTab('unknown')).toBe('overview');
  });

  it('parses known tab ids', () => {
    for (const tab of BROWSER_TABS) {
      expect(parseBrowserTab(tab)).toBe(tab);
    }
  });

  it('maps legacy focus ids to tabs', () => {
    expect(LEGACY_BROWSER_FOCUS_TO_TAB.extension).toBe('extension');
    expect(LEGACY_BROWSER_FOCUS_TO_TAB.cloak).toBe('cloakbrowser');
    expect(LEGACY_BROWSER_FOCUS_TO_TAB.runtime).toBe('overview');
    expect(LEGACY_BROWSER_FOCUS_TO_TAB.security).toBe('overview');
  });

  it('maps legacy behavior tab to overview', () => {
    expect(parseBrowserTab('behavior')).toBe('overview');
  });

  it('maps backend tabs to backend modes', () => {
    expect(browserTabToBackend('extension')).toBe('extension');
    expect(browserTabToBackend('overview')).toBeNull();
  });
});
