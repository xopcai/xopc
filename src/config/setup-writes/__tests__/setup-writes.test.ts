import { describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../schema.js';
import {
  applyAgentDefaultModelPatch,
  applyHeartbeatPatch,
  applyMcpServersPatch,
  applySearchTuningPatch,
  validateMcpServersPatch,
} from '../index.js';

function minimalConfig(): Config {
  return ConfigSchema.parse({});
}

describe('setup-writes mutators', () => {
  it('applySearchTuningPatch updates region, maxResults, and blocklist', () => {
    const next = applySearchTuningPatch(minimalConfig(), {
      region: 'cn',
      maxResults: 10,
      blocklistEnabled: true,
      blocklistDomains: ['blocked.example'],
    });
    expect(next.tools?.web?.region).toBe('cn');
    expect(next.tools?.web?.search?.maxResults).toBe(10);
    expect(next.tools?.web?.blocklist?.enabled).toBe(true);
    expect(next.tools?.web?.blocklist?.domains).toEqual(['blocked.example']);
  });

  it('validateMcpServersPatch rejects servers without command or url', () => {
    const errors = validateMcpServersPatch({
      servers: { bad: { args: ['-y', 'pkg'] } },
    });
    expect(errors.some((e) => e.path === 'servers.bad')).toBe(true);
  });

  it('applyMcpServersPatch writes stdio server and session TTL', () => {
    const next = applyMcpServersPatch(minimalConfig(), {
      servers: {
        gh: { command: 'npx', args: ['-y', 'pkg'] },
      },
      sessionIdleTtlMinutes: 5,
    });
    expect(next.mcp?.servers?.gh?.command).toBe('npx');
    expect(next.mcp?.sessionIdleTtlMs).toBe(300_000);
  });

  it('applyHeartbeatPatch merges gateway heartbeat fields', () => {
    const next = applyHeartbeatPatch(minimalConfig(), {
      enabled: false,
      intervalMs: 3_600_000,
      target: 'telegram',
    });
    expect(next.gateway?.heartbeat?.enabled).toBe(false);
    expect(next.gateway?.heartbeat?.intervalMs).toBe(3_600_000);
    expect(next.gateway?.heartbeat?.target).toBe('telegram');
  });

  it('applyAgentDefaultModelPatch sets string or object model field', () => {
    const plain = applyAgentDefaultModelPatch(minimalConfig(), {
      model: 'openai/gpt-4o',
    });
    expect(plain.agents?.defaults?.model).toBe('openai/gpt-4o');

    const withFallbacks = applyAgentDefaultModelPatch(minimalConfig(), {
      model: 'openai/gpt-4o',
      fallbacks: ['anthropic/claude-sonnet-4-5'],
    });
    expect(withFallbacks.agents?.defaults?.model).toEqual({
      primary: 'openai/gpt-4o',
      fallbacks: ['anthropic/claude-sonnet-4-5'],
    });
  });
});
