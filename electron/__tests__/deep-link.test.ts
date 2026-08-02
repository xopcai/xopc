import { describe, expect, it } from 'vitest';

import { xopcDeepLinkToRoute } from '../deep-link.js';

describe('xopcDeepLinkToRoute', () => {
  it('maps product and settings links to main-window routes', () => {
    expect(xopcDeepLinkToRoute('xopc://open?kind=local_app&id=app%2Freading+list')).toBe(
      '/open?kind=local_app&id=app%2Freading+list',
    );
    expect(xopcDeepLinkToRoute('xopc://settings/appearance?tab=theme')).toBe(
      '/settings/appearance?tab=theme',
    );
  });

  it('rejects malformed and unsupported links', () => {
    expect(xopcDeepLinkToRoute('xopc://open?kind=local_app')).toBeNull();
    expect(xopcDeepLinkToRoute('xopc://unknown/path')).toBeNull();
    expect(xopcDeepLinkToRoute('https://example.com')).toBeNull();
  });
});
