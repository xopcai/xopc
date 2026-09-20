import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CliToolProvider } from '../../../agent/external-tools/cliProvider.js';
import type { Config } from '../../../config/schema.js';
import type { ProcessResult } from '../../../process/process-spec.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { getConnectorDefinition } from '../../catalog.js';
import { startCliAuthorization } from '../authorization.js';
import { startCliProcess } from '../process.js';
import { readCliAuthorization } from '../store.js';

vi.mock('../installer.js', () => ({ verifyInstalledCli: vi.fn().mockResolvedValue('/test/lark-cli') }));
vi.mock('../process.js', async importOriginal => ({
  ...await importOriginal<typeof import('../process.js')>(),
  startCliProcess: vi.fn(),
}));

let directory: string;
let config: Config;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cli-auth-'));
  vi.stubEnv('XOPC_STATE_DIR', directory);
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(directory, 'test.db') });
  const definition = getConnectorDefinition('feishu-workspace')!;
  config = { connectors: { instances: { [definition.id]: { runtime: definition.runtime,
    xopcConnector: { managed: true, connectorId: definition.id, definition, enabled: true } } } } } as unknown as Config;
  vi.mocked(startCliProcess).mockReset();
});
afterEach(() => {
  closeXopcDatabase();
  resetXopcDatabaseSingletonForTest();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

const output = (exitCode: number, value: unknown): ProcessResult => ({
  exitCode, stdout: JSON.stringify(value), stderr: '', signal: null,
  timedOut: false, aborted: false, outputTruncated: false, terminationVerified: true,
});

it.each([true, false])('requires a verified identity after partial consent (verified=%s)', async verified => {
  const replies = [
    output(0, {}),
    output(3, { event: 'authorization_complete', user_open_id: 'user', warning: { type: 'missing_scope' }, missing: ['write'], granted: ['read'] }),
    output(0, { appId: 'app', identities: { user: { available: true, verified, openId: 'user', scope: 'read' } } }),
  ];
  vi.mocked(startCliProcess).mockImplementation(async () => ({
    completion: Promise.resolve(replies.shift()!),
  } as Awaited<ReturnType<typeof startCliProcess>>));
  const attempt = startCliAuthorization(config, 'feishu-workspace');
  await vi.waitFor(() => expect(readCliAuthorization(attempt.id)?.phase).toBe(verified ? 'succeeded' : 'failed'));
  expect(startCliProcess).toHaveBeenLastCalledWith(expect.objectContaining({ args: ['auth', 'status', '--json', '--verify'] }));
  expect(Boolean(readCliAuthorization(attempt.id)?.account_id)).toBe(verified);
  if (verified) {
    const provider = new CliToolProvider({ getConfig: () => config, getCurrentContext: () => null });
    for (const query of ['Lark', 'Feishu Lark docs list documents drive files', 'lark feishu drive file list']) {
      expect(await provider.search(query)).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: 'cli', title: 'docs.search' }),
        expect.objectContaining({ source: 'cli', title: 'drive.files.list' }),
      ]));
    }
  }
});

it('commits WPS only after delegated user verification and exposes its read tools', async () => {
  const definition = getConnectorDefinition('wps365-workspace')!;
  const wpsConfig = { connectors: { instances: { [definition.id]: { runtime: definition.runtime,
    xopcConnector: { managed: true, connectorId: definition.id, definition, enabled: true } } } } } as unknown as Config;
  const replies = [output(0, {}), output(0, {}), output(0, { code: 0, data: { id: 'user', company_id: 'company', user_name: 'WPS User' } })];
  vi.mocked(startCliProcess).mockImplementation(async () => ({
    completion: Promise.resolve(replies.shift()!),
  } as Awaited<ReturnType<typeof startCliProcess>>));
  const attempt = startCliAuthorization(wpsConfig, definition.id);
  await vi.waitFor(() => expect(readCliAuthorization(attempt.id)?.phase).toBe('succeeded'));
  expect(startCliProcess).toHaveBeenLastCalledWith(expect.objectContaining({ args: ['user', 'me', '--token-type', 'delegated', '--output', 'json'] }));
  const provider = new CliToolProvider({ getConfig: () => wpsConfig, getCurrentContext: () => null });
  const hits = await provider.search('WPS documents');
  expect(hits).toHaveLength(14);
  const described = await provider.describe(hits.find(hit => hit.title === 'drive.file.list')!.toolRef);
  expect(described).toMatchObject({ source: 'cli', batchRead: true });
});
