import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock('node:child_process', () => mocks);
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), isPackaged: true } }));

import { spawnGatewayProcess } from '../gateway-process.js';

let root: string;
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
afterEach(() => {
  vi.unstubAllEnvs();
  if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
  else delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (root) rmSync(root, { recursive: true, force: true });
});

it('persists fatal stderr after exit when pipes close, with exit code and signal', () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-supervisor-'));
  vi.stubEnv('XOPC_LOG_DIR', root);
  Object.defineProperty(process, 'resourcesPath', { value: root, configurable: true });
  const child = Object.assign(new EventEmitter(), {
    pid: 123, stdout: new EventEmitter(), stderr: new EventEmitter(),
  });
  mocks.spawn.mockReturnValue(child);
  const onUnexpectedExit = vi.fn();
  spawnGatewayProcess({ configPath: join(root, 'xopc.json'), workspacePath: root,
    port: 18790, bind: 'loopback', onUnexpectedExit });
  expect(() => child.stdout.emit('error', new Error('pipe read failed'))).not.toThrow();
  child.emit('exit', 1, null);
  child.stderr.emit('data', Buffer.from('Error: fatal after exit\n    at timer\n'));
  child.emit('close', 1, null);
  expect(onUnexpectedExit).toHaveBeenCalledWith(1, null);
  const log = readFileSync(join(root, 'gateway-supervisor.log'), 'utf8');
  expect(log).toContain('fatal after exit');
  expect(log).toContain('gateway_closed');
  expect(log).toContain('code: 1');
  expect(log).toContain('signal: null');
  expect(mocks.spawn.mock.calls[0]![2].env.XOPC_GATEWAY_DIAGNOSTIC_PATH).toBe(join(root, 'gateway-process.log'));
  expect(mocks.spawn.mock.calls[0]![2].env.XOPC_SQLITE_ASSET_ROOT).toBe(join(process.cwd(), 'out', 'server'));
});
