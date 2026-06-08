import { describe, expect, it } from 'vitest';

import {
  buildSafeBrowserConfigForWeb,
  buildSafeMcpConfigForWeb,
  buildSafeWebConfigPayload,
} from '../config-payload.js';

describe('buildSafeBrowserConfigForWeb', () => {
  it('keeps local backend for config reloads', () => {
    const safe = buildSafeBrowserConfigForWeb({
      enabled: true,
      headless: true,
      backend: 'local',
    });

    expect(safe).toMatchObject({
      enabled: true,
      headless: true,
      backend: 'local',
    });
  });

  it('keeps cloakbrowser backend and related settings for config reloads', () => {
    const safe = buildSafeBrowserConfigForWeb({
      enabled: true,
      headless: false,
      backend: 'cloakbrowser',
      cloakbrowser: {
        keepOpen: true,
        temporaryProfile: false,
        cacheDir: '/Users/test/.xopc/bin',
        binaryPath: '/Users/test/.xopc/bin/CloakBrowser.app/Contents/MacOS/CloakBrowser',
        timezone: 'America/Los_Angeles',
        locale: 'en-US',
        webrtcIp: '203.0.113.1',
        fingerprintPlatform: 'macos',
        extraArgs: ['--disable-dev-shm-usage'],
      },
      humanize: true,
      humanPreset: 'careful',
    });

    expect(safe).toMatchObject({
      enabled: true,
      backend: 'cloakbrowser',
      cloakbrowser: {
        keepOpen: true,
        temporaryProfile: false,
        cacheDir: '/Users/test/.xopc/bin',
        binaryPath: '/Users/test/.xopc/bin/CloakBrowser.app/Contents/MacOS/CloakBrowser',
        timezone: 'America/Los_Angeles',
        locale: 'en-US',
        webrtcIp: '203.0.113.1',
        fingerprintPlatform: 'macos',
        extraArgs: ['--disable-dev-shm-usage'],
      },
      humanize: true,
      humanPreset: 'careful',
    });
  });
});

describe('buildSafeWebConfigPayload', () => {
  it('includes agent default typed models for config round trips', async () => {
    const payload = await buildSafeWebConfigPayload({
      currentConfig: {
        agents: {
          defaults: {
            models: [
              { id: 'small', description: 'Fast model', model: 'ollama/AutoGLM-Phone-9B:latest' },
            ],
          },
        },
        channels: {},
      },
    } as never);

    expect(payload.agents.defaults.models).toEqual([
      { id: 'small', description: 'Fast model', model: 'ollama/AutoGLM-Phone-9B:latest' },
    ]);
  });
});

describe('buildSafeMcpConfigForWeb', () => {
  it('returns empty servers when mcp is unset', () => {
    expect(buildSafeMcpConfigForWeb({} as never)).toEqual({ servers: {} });
  });

  it('includes sessionIdleTtlMs and normalized servers', () => {
    const safe = buildSafeMcpConfigForWeb({
      mcp: {
        sessionIdleTtlMs: 600_000,
        servers: {
          tb: {
            url: 'https://example.com/mcp',
            transport: 'streamable-http',
            headers: { Authorization: 'Bearer secret' },
          },
        },
      },
    } as never);

    expect(safe.sessionIdleTtlMs).toBe(600_000);
    expect(safe.servers.tb).toMatchObject({
      url: 'https://example.com/mcp',
      transport: 'streamable-http',
      headers: { Authorization: 'Bearer secret' },
    });
  });
});
