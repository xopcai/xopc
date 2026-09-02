import { describe, expect, it } from 'vitest';

import {
  buildBrowserConfig,
  parseBrowserSettings,
} from '@/features/settings/config-api';

describe('browser config API', () => {
  it('parses extension connectionTimeout and cloak fingerprint fields', () => {
    const state = parseBrowserSettings({
      browser: {
        enabled: true,
        backend: 'cloakbrowser',
        extension: { port: 19999, host: '10.0.0.1', connectionTimeout: 45_000 },
        cloakbrowser: {
          timezone: 'America/New_York',
          locale: 'en-US',
          webrtcIp: '203.0.113.10',
          fingerprintPlatform: 'macos',
          extraArgs: ['--disable-dev-shm-usage', '  '],
        },
      },
    });

    expect(state.browserBackend).toBe('cloakbrowser');
    expect(state.browserExtensionConnectionTimeout).toBe(45_000);
    expect(state.browserCloakTimezone).toBe('America/New_York');
    expect(state.browserCloakLocale).toBe('en-US');
    expect(state.browserCloakWebrtcIp).toBe('203.0.113.10');
    expect(state.browserCloakFingerprintPlatform).toBe('macos');
    expect(state.browserCloakExtraArgs).toBe('--disable-dev-shm-usage');
  });

  it('round-trips local backend through parse → build → parse', () => {
    const initial = parseBrowserSettings({
      browser: {
        enabled: true,
        backend: 'local',
        headless: true,
      },
    });

    expect(initial.browserBackend).toBe('local');

    const built = buildBrowserConfig(initial);
    expect(built.backend).toBe('local');

    const roundTripped = parseBrowserSettings({
      browser: built,
    });
    expect(roundTripped.browserBackend).toBe('local');
    expect(roundTripped.browserHeadless).toBe(true);
  });

  it('buildBrowserConfig serializes extension and cloak slices', () => {
    const base = parseBrowserSettings({});
    const state = {
      ...base,
      browserEnabled: true,
      browserBackend: 'extension' as const,
      browserExtensionPort: 19820,
      browserExtensionHost: '127.0.0.1',
      browserExtensionConnectionTimeout: 30_000,
    };

    expect(buildBrowserConfig(state)).toMatchObject({
      enabled: true,
      backend: 'extension',
      extension: {
        port: 19820,
        host: '127.0.0.1',
        connectionTimeout: 30_000,
      },
    });

    const cloakState = {
      ...base,
      browserEnabled: true,
      browserBackend: 'cloakbrowser' as const,
      browserCloakTimezone: 'Europe/Berlin',
      browserCloakExtraArgs: '--foo\n--bar\n',
    };

    expect(buildBrowserConfig(cloakState)).toMatchObject({
      backend: 'cloakbrowser',
      cloakbrowser: {
        timezone: 'Europe/Berlin',
        extraArgs: ['--foo', '--bar'],
      },
      humanize: true,
      humanPreset: 'careful',
    });
  });

  it('round-trips cloak advanced fields through parse → build → parse', () => {
    const initial = parseBrowserSettings({
      browser: {
        enabled: true,
        backend: 'cloakbrowser',
        humanize: false,
        humanPreset: 'default',
        cloakbrowser: {
          keepOpen: false,
          temporaryProfile: true,
          cacheDir: '~/.xopc/bin/cloak',
          binaryPath: '/tmp/chromium',
          timezone: 'Asia/Tokyo',
          locale: 'ja-JP',
          webrtcIp: '198.51.100.2',
          fingerprintPlatform: 'windows',
          extraArgs: ['--no-sandbox'],
        },
      },
    });

    const built = buildBrowserConfig(initial);
    const roundTripped = parseBrowserSettings({
      browser: built,
    });

    expect(roundTripped.browserBackend).toBe('cloakbrowser');
    expect(roundTripped.browserCloakKeepOpen).toBe(false);
    expect(roundTripped.browserCloakTemporaryProfile).toBe(true);
    expect(roundTripped.browserCloakCacheDir).toBe('~/.xopc/bin/cloak');
    expect(roundTripped.browserCloakBinaryPath).toBe('/tmp/chromium');
    expect(roundTripped.browserCloakTimezone).toBe('Asia/Tokyo');
    expect(roundTripped.browserCloakLocale).toBe('ja-JP');
    expect(roundTripped.browserCloakWebrtcIp).toBe('198.51.100.2');
    expect(roundTripped.browserCloakFingerprintPlatform).toBe('windows');
    expect(roundTripped.browserCloakExtraArgs).toBe('--no-sandbox');
    expect(roundTripped.browserHumanize).toBe(false);
    expect(roundTripped.browserHumanPreset).toBe('default');
  });

  it('omits empty cloak extraArgs on build', () => {
    const base = parseBrowserSettings({});
    const built = buildBrowserConfig({
      ...base,
      browserEnabled: true,
      browserBackend: 'cloakbrowser',
      browserCloakExtraArgs: '  \n  ',
    });

    expect((built.cloakbrowser as { extraArgs?: unknown }).extraArgs).toBeUndefined();
  });
});
