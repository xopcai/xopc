import { describe, expect, it } from 'vitest';

import {
  AUTHENTICATED_LAZY_ROUTE_BUNDLES,
  findAuthenticatedLazyRouteBundle,
} from '../lazy-bundles.js';

describe('lazy route bundles', () => {
  it('keeps chat-critical routes off the lazy registry', () => {
    const paths = [
      '/api/status',
      '/api/agent/resume',
      '/api/events',
      '/api/sessions/example/inputs',
      '/api/send',
    ];
    for (const path of paths) {
      expect(findAuthenticatedLazyRouteBundle(path)).toBeUndefined();
    }
  });

  it('maps admin routes to lazy bundles', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/config')?.id).toBe('config');
    expect(findAuthenticatedLazyRouteBundle('/api/logs/stream')?.id).toBe('logs');
    expect(findAuthenticatedLazyRouteBundle('/api/extensions')?.id).toBe('auth-registry-extensions');
    expect(findAuthenticatedLazyRouteBundle('/api/automations/abc')?.id).toBe('automations');
    expect(findAuthenticatedLazyRouteBundle('/api/capabilities/connectors')?.id).toBe('capabilities');
  });

  it('keeps authenticated tunnel pair routes off the public lazy bundle', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/tunnel/pair/context')?.id).toBe('tunnel');
    expect(findAuthenticatedLazyRouteBundle('/api/tunnel/pair/enable-lan')?.id).toBe('tunnel');
  });

  it('uses distinct bundles for voice models vs voice settings', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/voice/models')?.id).toBe('agents');
    expect(findAuthenticatedLazyRouteBundle('/api/voice/providers')?.id).toBe('voice');
  });

  it('routes browser install SSE streams to browser-install, not the broader browser bundle', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/browser/cloakbrowser/install/stream')?.id).toBe(
      'browser-install',
    );
    expect(findAuthenticatedLazyRouteBundle('/api/browser/playwright/install/stream')?.id).toBe(
      'browser-install',
    );
    // Non-stream browser settings (doctor / launch / cdp / cloud) live in the
    // `browser` bundle — separate from `config` so the giant config patcher
    // does not load when the UI is only inspecting the extension status.
    expect(findAuthenticatedLazyRouteBundle('/api/browser/cloakbrowser/doctor')?.id).toBe('browser');
  });

  it('routes image generation APIs to models, not agents', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/image-generation/catalog')?.id).toBe('image-generation');
    expect(findAuthenticatedLazyRouteBundle('/api/agents/main/image-generation')?.id).toBe('image-generation');
    expect(findAuthenticatedLazyRouteBundle('/api/agents')?.id).toBe('agents');
  });

  it('routes gateway auth secret reveal to config, not extension-gateway', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/gateway/reveal-auth-secret/token')?.id).toBe('config');
    expect(findAuthenticatedLazyRouteBundle('/api/gateway/reveal-auth-secret')?.id).toBe('config');
    expect(findAuthenticatedLazyRouteBundle('/api/gateway/some-method')?.id).toBe('extension-gateway');
  });

  it('routes search api key reveal to config', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/tools/web/reveal-search-api-key')?.id).toBe('config');
  });

  it('routes models-json config endpoints to the models bundle', () => {
    // /api/models-json is `/api/models` + `-json`, not `/api/models/...`,
    // so the prefix matcher needs an explicit entry. Without it the
    // models settings panel sees a 404 on every load.
    expect(findAuthenticatedLazyRouteBundle('/api/models-json')?.id).toBe('models');
    expect(findAuthenticatedLazyRouteBundle('/api/models-json/validate')?.id).toBe('models');
    expect(findAuthenticatedLazyRouteBundle('/api/models-json/reload')?.id).toBe('models');
    expect(findAuthenticatedLazyRouteBundle('/api/models-json/test-api-key')?.id).toBe('models');
  });

  it('has unique bundle ids', () => {
    const ids = AUTHENTICATED_LAZY_ROUTE_BUNDLES.map((bundle) => bundle.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
