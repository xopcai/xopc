import { describe, expect, it } from 'vitest';

import { canUseDomEditor } from '../editor/editor-platform';

describe('editor platform selection', () => {
  it('keeps Expo Go on the fallback editor', () => {
    expect(canUseDomEditor({
      isStoreClient: true,
      hasExpoDomWebViewModule: true,
    })).toBe(false);
  });

  it('allows Android to use the DOM editor when the Expo DOM WebView module is present', () => {
    expect(canUseDomEditor({
      hasExpoDomWebViewModule: true,
    })).toBe(true);
  });

  it('allows Android to use the DOM editor when the native view manager is registered', () => {
    expect(canUseDomEditor({
      getViewManagerConfig: (name) => (name === 'ViewManagerAdapter_ExpoDomWebViewModule' ? {} : null),
    })).toBe(true);
  });

  it('falls back when no native DOM WebView implementation is registered', () => {
    expect(canUseDomEditor({
      getViewManagerConfig: () => null,
    })).toBe(false);
  });

  it('falls back when native view manager detection throws', () => {
    expect(canUseDomEditor({
      getViewManagerConfig: () => {
        throw new Error('unavailable');
      },
    })).toBe(false);
  });
});
