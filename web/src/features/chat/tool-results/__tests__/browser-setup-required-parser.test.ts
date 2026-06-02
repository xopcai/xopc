import { describe, expect, it } from 'vitest';

import { parseBrowserSetupRequired } from '../browser-setup-required-card';

describe('parseBrowserSetupRequired', () => {
  it('returns null for empty / non-JSON / non-object input', () => {
    expect(parseBrowserSetupRequired(undefined)).toBeNull();
    expect(parseBrowserSetupRequired('')).toBeNull();
    expect(parseBrowserSetupRequired('   ')).toBeNull();
    expect(parseBrowserSetupRequired('not json')).toBeNull();
    expect(parseBrowserSetupRequired('"just a string"')).toBeNull();
    expect(parseBrowserSetupRequired('null')).toBeNull();
  });

  it('returns null when kind is missing or wrong', () => {
    expect(parseBrowserSetupRequired(JSON.stringify({ backend: 'extension' }))).toBeNull();
    expect(
      parseBrowserSetupRequired(
        JSON.stringify({ kind: 'something_else', backend: 'extension', reason: 'extension_not_connected', deepLink: '/settings/agent-browser?tab=extension' }),
      ),
    ).toBeNull();
  });

  it('rejects unknown backends and reasons', () => {
    expect(
      parseBrowserSetupRequired(
        JSON.stringify({
          kind: 'browser_setup_required',
          backend: 'firefox',
          reason: 'extension_not_connected',
          deepLink: '/settings/agent-browser?tab=extension',
        }),
      ),
    ).toBeNull();
    expect(
      parseBrowserSetupRequired(
        JSON.stringify({
          kind: 'browser_setup_required',
          backend: 'extension',
          reason: 'meteor_strike',
          deepLink: '/settings/agent-browser?tab=extension',
        }),
      ),
    ).toBeNull();
  });

  it('rejects deepLinks not pointing at /settings/', () => {
    expect(
      parseBrowserSetupRequired(
        JSON.stringify({
          kind: 'browser_setup_required',
          backend: 'extension',
          reason: 'extension_not_connected',
          deepLink: 'https://evil.example.com/phish',
        }),
      ),
    ).toBeNull();
  });

  it('parses a well-formed payload', () => {
    const text = JSON.stringify({
      kind: 'browser_setup_required',
      backend: 'extension',
      reason: 'extension_not_connected',
      deepLink: '/settings/agent-browser?tab=extension',
      detail: 'no client connected',
      message: 'Browser is not ready (extension_not_connected).',
    });
    const parsed = parseBrowserSetupRequired(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.backend).toBe('extension');
    expect(parsed?.reason).toBe('extension_not_connected');
    expect(parsed?.deepLink).toBe('/settings/agent-browser?tab=extension');
    expect(parsed?.detail).toBe('no client connected');
    expect(parsed?.message).toContain('not ready');
  });

  it.each([
    ['local', 'local_chromium_missing'],
    ['cloakbrowser', 'cloakbrowser_not_installed'],
    ['cdp', 'cdp_unreachable'],
    ['cloud', 'cloud_api_key_missing'],
  ] as const)('accepts %s + %s', (backend, reason) => {
    const parsed = parseBrowserSetupRequired(
      JSON.stringify({
        kind: 'browser_setup_required',
        backend,
        reason,
        deepLink: `/settings/agent-browser?tab=${backend}`,
      }),
    );
    expect(parsed?.backend).toBe(backend);
    expect(parsed?.reason).toBe(reason);
  });

  it('ignores extra fields', () => {
    const parsed = parseBrowserSetupRequired(
      JSON.stringify({
        kind: 'browser_setup_required',
        backend: 'local',
        reason: 'local_chromium_missing',
        deepLink: '/settings/agent-browser?tab=local',
        extra: 'ignored',
        nested: { foo: 1 },
      }),
    );
    expect(parsed?.backend).toBe('local');
    // `detail` & `message` left undefined when not provided.
    expect(parsed?.detail).toBeUndefined();
    expect(parsed?.message).toBeUndefined();
  });
});
