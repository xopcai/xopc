import { describe, expect, it } from 'vitest';

import { canUseDomEditor } from '../editor/editor-platform';

describe('editor platform selection', () => {
  it('uses the DOM editor on web', () => {
    expect(canUseDomEditor({ platform: 'web' })).toBe(true);
  });

  it('keeps Expo Go on the fallback editor', () => {
    expect(canUseDomEditor({
      platform: 'ios',
      isStoreClient: true,
      hasExpoDomWebViewModule: true,
    })).toBe(false);
  });

  it('allows Android to use the DOM editor when the Expo DOM WebView module is present', () => {
    expect(canUseDomEditor({
      platform: 'android',
      hasExpoDomWebViewModule: true,
    })).toBe(true);
  });

  it('allows Android to use the DOM editor when the native view manager is registered', () => {
    expect(canUseDomEditor({
      platform: 'android',
      getViewManagerConfig: (name) => (name === 'ViewManagerAdapter_ExpoDomWebViewModule' ? {} : null),
    })).toBe(true);
  });

  it('falls back when no native DOM WebView implementation is registered', () => {
    expect(canUseDomEditor({
      platform: 'android',
      getViewManagerConfig: () => null,
    })).toBe(false);
  });

  it('falls back when native view manager detection throws', () => {
    expect(canUseDomEditor({
      platform: 'ios',
      getViewManagerConfig: () => {
        throw new Error('unavailable');
      },
    })).toBe(false);
  });
});
