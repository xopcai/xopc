import { describe, expect, it, vi } from 'vitest';

import { PlatformRuntimeClient, RuntimeCommandSchema, discoverPlatform } from '../client.js';
import { AgentManifestSchema, PlatformEventSchema, type PlatformDiscovery } from '../contracts.js';

const discovery: PlatformDiscovery = {
  schemaVersion: '1',
  platformId: 'xopc-test',
  displayName: 'XOPC Test',
  deploymentMode: 'private',
  region: 'local',
  endpoints: {
    authorizationServer: 'https://platform.test',
    controlApi: 'https://platform.test/api/v1/platform',
    agentApi: 'https://runtime.test/api/v1/runtime',
    a2aApi: 'https://platform.test/api/v1/a2a',
  },
  capabilities: {
    models: false, connectors: false, tunnels: false, shares: false,
    managedRuntime: false, runtimeFleet: true, traceUpload: false, a2a: true,
  },
  protocols: { xopc: { min: '0.0.1', max: '0.x' }, mcp: [], a2a: ['1.0'] },
};

describe('platform client', () => {
  it('rejects run events without a monotonic sequence', () => {
    expect(() => PlatformEventSchema.parse({
      schemaVersion: '1', eventId: 'event-1', type: 'xopc.run.started', time: new Date().toISOString(),
      organizationId: 'org-1', workspaceId: 'workspace-1', runId: 'run-1', traceId: 'trace-1',
      producer: 'runtime-1', payload: {},
    })).toThrow('Run events require a sequence');
  });

  it('validates the shared versioned agent manifest contract', () => {
    expect(AgentManifestSchema.parse({
      schemaVersion: '1', agentId: 'agent.test', version: '1.0.0',
      runtime: { engine: 'xopc', requires: '>=0.1.0', execution: ['local'] },
      entry: { instructions: 'agent.md' }, models: { intents: ['reasoning'], allow: ['workspace-default'] },
      dependencies: { skills: [], connectors: [] },
      permissions: { tools: [], networkDomains: [], filesystem: [], effects: ['read'] },
      data: { classification: 'internal', memory: 'local', retentionPolicy: 'default' }, quality: {},
    }).dependencies.extensions).toEqual([]);
  });

  it('discovers and validates a platform from one base URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(discovery), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
    await expect(discoverPlatform('https://platform.test/', fetchImpl)).resolves.toEqual(discovery);
    expect(fetchImpl).toHaveBeenCalledWith('https://platform.test/.well-known/xopc-platform', expect.any(Object));
  });

  it('uses only the discovered runtime endpoint', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://runtime.test/api/v1/runtime/lease');
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const client = new PlatformRuntimeClient(discovery, `xopc_rt_${'a'.repeat(43)}`, fetchImpl);
    await expect(client.lease()).resolves.toBeNull();
  });

  it('validates lease renewal cancellation state', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      leaseExpiresAt: Date.now() + 60_000,
      cancelRequested: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const client = new PlatformRuntimeClient(discovery, `xopc_rt_${'a'.repeat(43)}`, fetchImpl);
    await expect(client.renew('command-1', 'lease-1')).resolves.toEqual({
      leaseExpiresAt: expect.any(Number), cancelRequested: true,
    });
  });

  it('validates leased run commands before a worker can execute them', async () => {
    const command = {
      id: 'command-1', runId: 'run-1', type: 'run.start', leaseToken: 'lease-1', leaseExpiresAt: Date.now() + 30_000,
      payload: {
        runId: 'run-1', traceId: 'trace-1', agentVersionId: 'version-1', organizationId: 'org-1',
        workspaceId: 'workspace-1', runtimeId: 'runtime-1',
        manifest: {
          schemaVersion: '1', agentId: 'agent.test', version: '1.0.0',
          runtime: { engine: 'xopc', requires: '>=0.1.0', execution: ['enterprise'] },
          entry: { instructions: 'agent.md' }, models: { intents: ['reasoning'], allow: ['workspace-default'] },
          dependencies: { skills: [], connectors: [], extensions: [] },
          permissions: { tools: [], networkDomains: [], filesystem: [], effects: ['read'] },
          data: { classification: 'internal', memory: 'local', retentionPolicy: 'default' }, quality: {},
        },
      },
    };
    expect(RuntimeCommandSchema.parse(command).payload).toEqual(command.payload);
    expect(() => RuntimeCommandSchema.parse({
      ...command,
      payload: { ...command.payload, runId: 'run-other' },
    })).toThrow('does not match');

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      command: { ...command, payload: { ...command.payload, manifest: { ...command.payload.manifest, schemaVersion: '2' } } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const client = new PlatformRuntimeClient(discovery, `xopc_rt_${'a'.repeat(43)}`, fetchImpl);
    await expect(client.lease()).rejects.toThrow();
  });

  it('rejects a platform without runtime fleet capability', () => {
    expect(() => new PlatformRuntimeClient(
      { ...discovery, capabilities: { ...discovery.capabilities, runtimeFleet: false } },
      `xopc_rt_${'a'.repeat(43)}`,
    )).toThrow('does not provide a runtime fleet');
  });
});
