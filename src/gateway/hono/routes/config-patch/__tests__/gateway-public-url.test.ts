import { describe, expect, it } from 'vitest';

import type { Config } from '../../../../../config/schema.js';
import { applyGatewayPatch } from '../gateway.js';

function minimalConfig(): Config {
  return {
    gateway: { port: 18790, corsOrigins: [] },
    agents: {
      defaults: {
        workspace: '/tmp/ws',
        maxTokens: 8192,
        temperature: 0.7,
        maxToolIterations: 20,
        maxRequestsPerTurn: 50,
        maxToolFailuresPerTurn: 3,
        thinkingDefault: 'medium',
        reasoningDefault: 'stream',
        verboseDefault: 'full',
      },
      list: [],
    },
    channels: {},
  } as Config;
}

describe('applyGatewayPatch publicUrl', () => {
  it('persists the Web UI activity detail default', () => {
    const cfg = minimalConfig();
    const result = applyGatewayPatch(cfg, {
      gateway: { webchat: { activityDetailDefault: 'on' } },
    });

    expect(result.ok).toBe(true);
    expect(cfg.gateway?.webchat?.activityDetailDefault).toBe('on');
  });

  it('rejects an invalid Web UI activity detail default', () => {
    const cfg = minimalConfig();
    const result = applyGatewayPatch(cfg, {
      gateway: { webchat: { activityDetailDefault: 'verbose' } },
    });

    expect(result.ok).toBe(false);
  });

  it('persists site share policy fields', () => {
    const cfg = minimalConfig();
    const result = applyGatewayPatch(cfg, {
      gateway: { siteShare: { maxActiveSites: 20 } },
    });
    expect(result.ok).toBe(true);
    expect(cfg.gateway?.siteShare?.maxActiveSites).toBe(20);
  });

  it('persists a normalized https publicUrl', () => {
    const cfg = minimalConfig();
    const result = applyGatewayPatch(cfg, {
      gateway: { publicUrl: 'https://Gateway.Example.com/' },
    });
    expect(result.ok).toBe(true);
    expect(cfg.gateway?.publicUrl).toBe('https://gateway.example.com');
  });

  it('clears publicUrl when null', () => {
    const cfg = minimalConfig();
    cfg.gateway = { ...cfg.gateway!, publicUrl: 'https://gateway.example.com' };
    const result = applyGatewayPatch(cfg, { gateway: { publicUrl: null } });
    expect(result.ok).toBe(true);
    expect(cfg.gateway?.publicUrl).toBeUndefined();
  });

  it('rejects invalid publicUrl values', () => {
    const cfg = minimalConfig();
    const result = applyGatewayPatch(cfg, {
      gateway: { publicUrl: 'http://public.example.com' },
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.message).toMatch(/https/i);
    }
  });
});
