import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';

import {
  isMcpToolDenied,
  isMcpToolName,
  parseMcpToolName,
  shouldCreateBundleMcpRuntimeForAttempt,
} from '../bundle-mcp-policy.js';

describe('bundle-mcp-policy', () => {
  it('detects MCP tool names by separator', () => {
    expect(isMcpToolName('fetch__get')).toBe(true);
    expect(isMcpToolName('exec_command')).toBe(false);
  });

  it('parses server and tool ids', () => {
    expect(parseMcpToolName('fetch__get')).toEqual({ serverId: 'fetch', toolId: 'get' });
    expect(parseMcpToolName('exec_command')).toBeNull();
  });

  it('creates a runtime only when MCP is configured', () => {
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
      shouldCreateBundleMcpRuntimeForAttempt({ mcp: { servers: { demo: { command: 'node' } } } } as Config),
    ).toBe(true);
    expect(shouldCreateBundleMcpRuntimeForAttempt(connectorManagedConfig)).toBe(true);
    expect(shouldCreateBundleMcpRuntimeForAttempt()).toBe(false);
  });

  it('applies server and registered-tool deny policies', () => {
    expect(isMcpToolDenied('fetch__get', { servers: { fetch: { mode: 'deny' } } })).toBe(true);
    expect(isMcpToolDenied('fetch__get', { tools: { fetch__get: { mode: 'deny' } } })).toBe(true);
    expect(isMcpToolDenied('fetch__get', { servers: { fetch: { mode: 'allow' } } })).toBe(false);
    expect(isMcpToolDenied('exec_command', { tools: { exec_command: { mode: 'deny' } } })).toBe(false);
  });
});
