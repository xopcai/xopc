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
  it('includes manifest typed models for config round trips', async () => {
    const payload = await buildSafeWebConfigPayload({
      currentConfig: {
        agents: {
          default: 'main',
          capabilityPresets: {},
          list: [
            {
              id: 'main',
              enabled: true,
              identity: { name: 'Main', role: 'Agent', language: 'en', tone: 'direct' },
              responsibilities: { primary: ['Help'] },
              workspace: { root: '/tmp/main' },
              models: {
                defaultRole: 'small',
                roles: { small: { description: 'Fast model', model: 'ollama/AutoGLM-Phone-9B:latest' } },
              },
              tools: { builtin: {} },
              skills: { mode: 'all' },
              memory: { mode: 'off', sources: ['session'] },
              workflows: {},
              boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
            },
          ],
        },
        channels: {},
      },
    } as never);

    expect(payload.agents.list[0]?.models.roles.small).toEqual({
      description: 'Fast model',
      model: 'ollama/AutoGLM-Phone-9B:latest',
    });
    expect(payload.gateway.skillsMarketplaceProvider).toBe('store');
    expect(payload.gateway.skillsStoreBaseUrl).toBe('https://store.xopc.ai');
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
