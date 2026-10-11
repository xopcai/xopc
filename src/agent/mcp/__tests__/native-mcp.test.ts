import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { getNativePiAgentDir, prepareNativeMcpConfig } from '../native-mcp.js';

vi.mock('../../../connectors/secret-store.js', () => ({
  resolveConnectorSecretReferences: async (value: Record<string, unknown>) => ({
    ...value, ...(value.headers ? { headers: { Authorization: 'Bearer resolved-secret' } } : {}),
  }),
}));

let state: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'xopc-native-config-'));
  vi.stubEnv('XOPC_STATE_DIR', state);
  vi.stubEnv('PI_CODING_AGENT_DIR', join(state, 'pi'));
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(state, { recursive: true, force: true }); });

it('projects native configuration and host secrets without leaking host markers', async () => {
  const prepared = await prepareNativeMcpConfig({ mcp: { servers: {
    docs: { type: 'streamable-http', url: 'https://example.com/mcp', headers: {
      Authorization: { xopcSecretRef: { provider: 'docs', fieldKey: 'token' } },
    }, exposure: 'deferred', toolExposure: { hidden: 'hidden' }, timeout: 30,
    oauth: { clientId: 'public-client', callbackPort: 8787 }, xopcPlugin: { id: 'docs' } },
  } } } as unknown as Config, state);
  expect(prepared.errors).toEqual([]);
  expect(prepared.servers).toEqual([{ name: 'docs', source: 'xopc.json', scope: 'extension', config: {
    type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer resolved-secret' },
    exposure: 'deferred', toolExposure: { hidden: 'hidden' }, timeout: 30,
    oauth: { clientId: 'public-client', callbackPort: 8787 },
  } }]);
});

it('rejects removed SSE and native name collisions before loading connections', async () => {
  const prepared = await prepareNativeMcpConfig({ mcp: { servers: {
    events: { type: 'sse', url: 'https://example.com' },
    'a-b': { command: 'node' }, a_b: { command: 'node' },
  } } } as unknown as Config, state);
  expect(prepared.servers.map(server => server.name)).toEqual(['a-b']);
  expect(prepared.errors).toHaveLength(2);
});

it('keeps one process-wide native state directory across workspace turns', async () => {
  await prepareNativeMcpConfig({} as Config, join(state, 'first'));
  const first = getNativePiAgentDir();
  await prepareNativeMcpConfig({} as Config, join(state, 'second'));
  expect(getNativePiAgentDir()).toBe(first);
  expect(first).toBe(join(state, 'pi'));
});
