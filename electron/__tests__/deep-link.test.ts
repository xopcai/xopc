import { describe, expect, it } from 'vitest';

import { xopcDeepLinkTarget, xopcDeepLinkToRoute } from '../deep-link.js';

describe('xopcDeepLinkToRoute', () => {
  it('maps product and settings links to main-window routes', () => {
    expect(xopcDeepLinkToRoute('xopc://open?kind=local_app&id=app%2Freading+list')).toBe(
      '/open?kind=local_app&id=app%2Freading+list',
    );
    expect(xopcDeepLinkToRoute('xopc://settings/appearance?tab=theme')).toBe(
      '/settings/appearance?tab=theme',
    );
    expect(xopcDeepLinkToRoute('xopc://cloud/model-connected?request_id=request-1')).toBe(
      '/settings/capabilities/models',
    );
    expect(xopcDeepLinkToRoute(
      'xopc://cloud/model-connected?request_id=request-1&return_path=%2Fchat%3Fonboarding%3D1',
    )).toBe('/chat?onboarding=1');
  });

  it('rejects malformed and unsupported links', () => {
    expect(xopcDeepLinkToRoute('xopc://open?kind=local_app')).toBeNull();
    expect(xopcDeepLinkToRoute('xopc://unknown/path')).toBeNull();
    expect(xopcDeepLinkToRoute('xopc://cloud/model-connected')).toBeNull();
    expect(xopcDeepLinkToRoute(
      'xopc://cloud/model-connected?request_id=request-1&return_path=%2F%2Fevil.example',
    )).toBe('/settings/capabilities/models');
    expect(xopcDeepLinkToRoute('https://example.com')).toBeNull();
  });

  it('focuses an existing renderer for OAuth completion instead of replacing wizard state', () => {
    expect(xopcDeepLinkTarget(
      'xopc://cloud/model-connected?request_id=request-1&return_path=%2Fchat',
    )).toEqual({ route: '/chat', focusOnlyWhenReady: true });
    expect(xopcDeepLinkTarget('xopc://settings/appearance')).toEqual({
      route: '/settings/appearance',
    });
  });
});
