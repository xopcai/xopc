import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';
import type { ProcessResult } from '../../../process/process-spec.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { fixtureDefinition } from './fixture-adapter.js';
import { startCliAuthorization } from '../authorization.js';
import { installCli } from '../installer.js';
import { startCliProcess } from '../process.js';
import { readCliAuthorization } from '../store.js';

vi.mock('../installer.js', () => ({
  installCli: vi.fn().mockResolvedValue('/test/fixture-cli'),
  verifyInstalledCli: vi.fn().mockResolvedValue('/test/fixture-cli'),
}));
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
  const definition = fixtureDefinition;
  config = { connectors: { instances: { [definition.id]: { runtime: definition.runtime,
    xopcConnector: { managed: true, connectorId: definition.id, definition, enabled: true } } } } } as unknown as Config;
  vi.mocked(startCliProcess).mockReset();
  vi.mocked(installCli).mockReset().mockResolvedValue('/test/fixture-cli');
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

it('fails authorization without launching the CLI when runtime recovery fails', async () => {
  vi.mocked(installCli).mockRejectedValueOnce(new Error('CLI download failed (503).'));
  const attempt = startCliAuthorization(config, 'fixture-cli');
  await vi.waitFor(() => expect(readCliAuthorization(attempt.id)?.phase).toBe('failed'));
  expect(readCliAuthorization(attempt.id)?.error).toBe('CLI download failed (503).');
  expect(startCliProcess).not.toHaveBeenCalled();
  expect(readCliAuthorization(attempt.id)?.account_id).toBeNull();
});

it.each([true, false])('commits only a verified CLI identity (%s)', async verified => {
  const replies = [output(0, {}), output(0, { identity: verified ? 'user' : 'unverified' })];
  vi.mocked(startCliProcess).mockImplementation(async () => ({ completion: Promise.resolve(replies.shift()!) } as Awaited<ReturnType<typeof startCliProcess>>));
  const attempt = startCliAuthorization(config, fixtureDefinition.id);
  await vi.waitFor(() => expect(readCliAuthorization(attempt.id)?.phase).toBe(verified ? 'succeeded' : 'failed'));
  expect(Boolean(readCliAuthorization(attempt.id)?.account_id)).toBe(verified);
});
