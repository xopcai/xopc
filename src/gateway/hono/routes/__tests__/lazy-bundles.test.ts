import { describe, expect, it } from 'vitest';

import {
  AUTHENTICATED_LAZY_ROUTE_BUNDLES,
  findAuthenticatedLazyRouteBundle,
} from '../lazy-bundles.js';

describe('lazy route bundles', () => {
  it('keeps chat-critical routes off the lazy registry', () => {
    const paths = ['/api/status', '/api/agent', '/api/events', '/api/sessions', '/api/send'];
    for (const path of paths) {
      expect(findAuthenticatedLazyRouteBundle(path)).toBeUndefined();
    }
  });

  it('maps admin routes to lazy bundles', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/config')?.id).toBe('config');
    expect(findAuthenticatedLazyRouteBundle('/api/logs/stream')?.id).toBe('logs');
    expect(findAuthenticatedLazyRouteBundle('/api/extensions')?.id).toBe('auth-registry-extensions');
    expect(findAuthenticatedLazyRouteBundle('/api/cron/abc')?.id).toBe('cron');
  });

  it('keeps authenticated tunnel pair routes off the public lazy bundle', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/tunnel/pair/context')?.id).toBe('tunnel');
    expect(findAuthenticatedLazyRouteBundle('/api/tunnel/pair/enable-lan')?.id).toBe('tunnel');
  });

  it('uses distinct bundles for voice models vs voice settings', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/voice/models')?.id).toBe('agents');
    expect(findAuthenticatedLazyRouteBundle('/api/voice/providers')?.id).toBe('voice');
  });

  it('routes browser install SSE streams to browser-install, not the broader config bundle', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/browser/cloakbrowser/install/stream')?.id).toBe(
      'browser-install',
    );
    expect(findAuthenticatedLazyRouteBundle('/api/browser/playwright/install/stream')?.id).toBe(
      'browser-install',
    );
    expect(findAuthenticatedLazyRouteBundle('/api/browser/cloakbrowser/doctor')?.id).toBe('config');
  });

  it('routes image generation APIs to models, not agents', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/image/providers')?.id).toBe('models');
    expect(findAuthenticatedLazyRouteBundle('/api/agents')?.id).toBe('agents');
  });

  it('has unique bundle ids', () => {
    const ids = AUTHENTICATED_LAZY_ROUTE_BUNDLES.map((bundle) => bundle.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
