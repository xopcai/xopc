import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';

import {
  isMcpToolName,
  parseMcpToolName,
  shouldCreateBundleMcpRuntimeForAttempt,
} from '../bundle-mcp-policy.js';

describe('bundle-mcp-policy', () => {
  it('detects MCP tool names by separator', () => {
    expect(isMcpToolName('fetch__get')).toBe(true);
    expect(isMcpToolName('shell')).toBe(false);
  });

  it('parses server and tool ids', () => {
    expect(parseMcpToolName('fetch__get')).toEqual({ serverId: 'fetch', toolId: 'get' });
    expect(parseMcpToolName('shell')).toBeNull();
  });

  it('respects bundle-mcp disable sentinel and configured runtime creation', () => {
    const connectorManagedConfig = {
      mcp: {
        servers: {
          fetch: {
            command: 'node',
            xopcConnector: { managed: true, connectorId: 'fetch', version: '1.0.0' },
          },
        },
      },
    } as Config;

    expect(
      shouldCreateBundleMcpRuntimeForAttempt({
        cfg: connectorManagedConfig,
        disabledTools: new Set(['bundle-mcp']),
      }),
    ).toBe(false);
    expect(
      shouldCreateBundleMcpRuntimeForAttempt({
        cfg: { mcp: { servers: { demo: { command: 'node' } } } },
      }),
    ).toBe(true);
    expect(
      shouldCreateBundleMcpRuntimeForAttempt({
        cfg: connectorManagedConfig,
      }),
    ).toBe(true);
  });
});
