import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommandDefinition } from '../registry.js';

const mocks = vi.hoisted(() => ({ main: vi.fn(), register: vi.fn(), loadConfig: vi.fn() }));
vi.mock('@earendil-works/pi-coding-agent', async importOriginal => ({
  ...await importOriginal<object>(), main: mocks.main,
}));
vi.mock('../registry.js', () => ({ register: mocks.register }));
vi.mock('../../config/loader.js', () => ({ loadConfig: mocks.loadConfig }));
await import('../commands/mcp.js');
const definition = mocks.register.mock.calls[0][0] as CommandDefinition;

let state: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'xopc-native-cli-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', state);
  vi.stubEnv('XOPC_STATE_DIR', state);
  mocks.main.mockReset();
  mocks.loadConfig.mockReturnValue({ mcp: { servers: { docs: { url: 'https://example.com/mcp', exposure: 'deferred' } } } });
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(state, { recursive: true, force: true }); });
const command = () => definition.factory({ configPath: join(state, 'xopc.json'), workspacePath: state, argv: [], isVerbose: false });

it('delegates list diagnostics to public pi main with a private generated config', async () => {
  await command().parseAsync(['list', '--json'], { from: 'user' });
  expect(mocks.main).toHaveBeenCalledWith(['mcp', 'list', '--json']);
  const path = join(state, 'mcp.json');
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ xopcGenerated: true, mcpServers: {
    docs: { url: 'https://example.com/mcp', exposure: 'deferred' },
  } });
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

it('delegates login and logout without maintaining an OAuth client', async () => {
  await command().parseAsync(['login', 'docs', '--timeout', '30'], { from: 'user' });
  expect(mocks.main).toHaveBeenLastCalledWith(['mcp', 'login', 'docs', '--timeout', '30']);
  await command().parseAsync(['logout', 'docs'], { from: 'user' });
  expect(mocks.main).toHaveBeenLastCalledWith(['mcp', 'logout', 'docs']);
});

it('refuses to overwrite a user-managed pi configuration', async () => {
  const path = join(state, 'mcp.json');
  const original = JSON.stringify({ mcpServers: { user: { command: 'node' } } });
  writeFileSync(path, original);
  await expect(command().parseAsync(['list'], { from: 'user' })).rejects.toThrow('user-managed');
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(mocks.main).not.toHaveBeenCalled();
});
