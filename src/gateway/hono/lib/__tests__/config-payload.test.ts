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
  it('includes the Web UI activity detail default', async () => {
    const payload = await buildSafeWebConfigPayload({
      currentConfig: {
        agents: { list: [] },
        channels: {},
        gateway: { webchat: { activityDetailDefault: 'stream' } },
      },
    } as never);

    expect(payload.gateway.webchat.activityDetailDefault).toBe('stream');
  });

  it('includes global model intents and agent overrides for config round trips', async () => {
    const payload = await buildSafeWebConfigPayload({
      currentConfig: {
        agents: {
          default: 'main',
          defaults: {
            models: {
              chat: { primary: 'openai/gpt-4.1', fallbacks: [] },
              intents: { fast: { primary: 'ollama/AutoGLM-Phone-9B:latest', fallbacks: [] } },
            },
          },
          list: [
            {
              id: 'main',
              enabled: true,
              profile: { name: 'Main' },
              workspace: '/tmp/main',
              models: {
                intents: { review: { primary: 'anthropic/claude-sonnet-4', fallbacks: [] } },
              },
            },
          ],
        },
        channels: {},
      },
    } as never);

    expect(payload.agents.list[0]?.models.intents.review).toEqual({
      primary: 'anthropic/claude-sonnet-4',
      fallbacks: [],
    });
    expect(payload.gateway.skillsMarketplaceProvider).toBe('store');
    expect(payload.gateway.skillsStoreBaseUrl).toBe('https://store.xopc.ai');
    expect(payload.userContext.memory.retention.compaction).toMatchObject({
      enabled: true,
      triggerThreshold: 0.8,
      reserveTokens: 8_192,
      qualityGuard: true,
    });
  });

  it('includes the strict global compaction policy for WebUI round trips', async () => {
    const payload = await buildSafeWebConfigPayload({
      currentConfig: {
        agents: { default: 'main', list: [] },
        channels: {},
        userContext: {
          memory: {
            mode: 'readOnly',
            sources: ['session'],
            retention: {
              compaction: {
                enabled: false,
                triggerThreshold: 0.7,
                reserveTokens: 12_000,
                minMessagesBeforeCompact: 6,
                keepRecentTokens: 16_000,
                recentTurnsPreserve: 2,
                summaryMaxTokens: 1_500,
                summaryChunkTokens: 18_000,
                summaryTimeoutMs: 90_000,
                summaryRetries: 1,
                qualityGuard: false,
                model: 'openai/gpt-5',
                minToolResultKeepChars: 800,
                maxActiveTranscriptBytes: 3_000_000,
                postCompactionSections: ['Red Lines'],
              },
            },
          },
        },
      },
    } as never);

    expect(payload.userContext.memory.retention.compaction).toEqual({
      enabled: false,
      triggerThreshold: 0.7,
      reserveTokens: 12_000,
      minMessagesBeforeCompact: 6,
      keepRecentTokens: 16_000,
      recentTurnsPreserve: 2,
      summaryMaxTokens: 1_500,
      summaryChunkTokens: 18_000,
      summaryTimeoutMs: 90_000,
      summaryRetries: 1,
      qualityGuard: false,
      gapAudit: true,
      model: 'openai/gpt-5',
      minToolResultKeepChars: 800,
      maxActiveTranscriptBytes: 3_000_000,
      postCompactionSections: ['Red Lines'],
    });
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
