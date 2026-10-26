import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
import { spawnFrpcProcess } from '../frpc-process.js';

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    pid: 123 as number | undefined, stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null as number | null, signalCode: null as string | null, killed: false,
    kill: vi.fn((_signal: string) => true),
  });
  mocks.spawn.mockReturnValue(child);
  return child;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe('frpc process readiness', () => {
  it('connects directly despite inherited proxy variables, preserving the Gateway environment', async () => {
    vi.stubEnv('HTTP_PROXY', 'http://127.0.0.1:7890');
    vi.stubEnv('http_proxy', 'http://127.0.0.1:7891');
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890');
    vi.stubEnv('NO_PROXY', 'frp.xopc.ai');
    vi.stubEnv('XOPC_TEST_FRPC_ENV', 'retained');
    const child = fakeChild();
    const handle = spawnFrpcProcess('frpc.exe', 'config.toml');
    const env = mocks.spawn.mock.calls[0][2].env as NodeJS.ProcessEnv;
    expect(Object.keys(env).some(name => name.toLowerCase() === 'http_proxy')).toBe(false);
    expect(env.XOPC_TEST_FRPC_ENV).toBe('retained');
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
    expect(process.env.HTTP_PROXY).toBe('http://127.0.0.1:7890');
    expect(process.env.http_proxy).toBe('http://127.0.0.1:7891');
    child.stdout.write('login to server success\n');
    await handle.waitForLoginSuccess;
  });

  it('recognizes login output split across pipe chunks and clears the deadline', async () => {
    const child = fakeChild();
    const handle = spawnFrpcProcess('frpc.exe', 'config.toml');
    child.stdout.write('2026 [I] login to serv');
    child.stdout.write('er success, get run id [123]\r\n');
    await expect(handle.waitForLoginSuccess).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a safe connection diagnostic on timeout without exposing raw child secrets', async () => {
    const child = fakeChild();
    const handle = spawnFrpcProcess('frpc.exe', 'config.toml');
    const result = expect(handle.waitForLoginSuccess).rejects.toThrow('frpc login timeout: Connection to FRP server timed out');
    child.stderr.write('login to server failed: dial tcp example:7000: i/o timeout token=secret\n');
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
  });

  it.each([
    ['connect to server error: unexpected EOF', 'FRP server login failed'],
    ['connect to server error: DialTcpByHttpProxy error, StatusCode [403]', 'Connection through configured proxy failed'],
    ['connect to server error: x509: certificate has expired', 'TLS certificate or handshake failed'],
  ])('preserves a safe diagnostic for %s', async (line, reason) => {
    const child = fakeChild();
    const handle = spawnFrpcProcess('frpc.exe', 'config.toml');
    const result = expect(handle.waitForLoginSuccess).rejects.toThrow(`frpc login timeout: ${reason}`);
    child.stderr.write(`${line}\n`);
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
  });

  it('rejects process startup errors even when no pid was assigned', async () => {
    const child = fakeChild();
    child.pid = undefined;
    const handle = spawnFrpcProcess('missing.exe', 'config.toml');
    const result = expect(handle.waitForLoginSuccess).rejects.toThrow('spawn ENOENT');
    child.emit('error', new Error('spawn ENOENT'));
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects early exit and clears the deadline', async () => {
    const child = fakeChild();
    const handle = spawnFrpcProcess('frpc.exe', 'config.toml');
    const result = expect(handle.waitForLoginSuccess).rejects.toThrow('frpc exited before login');
    child.emit('exit', 1, null);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('escalates to SIGKILL when SIGTERM was sent but the child has not exited', async () => {
    const child = fakeChild();
    const handle = spawnFrpcProcess('frpc.exe', 'config.toml');
    child.stdout.write('login to server success\n');
    await handle.waitForLoginSuccess;
    child.kill.mockImplementation(() => { child.killed = true; return true; });
    const stopping = handle.kill();
    await vi.advanceTimersByTimeAsync(3000);
    await stopping;
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  });
});
