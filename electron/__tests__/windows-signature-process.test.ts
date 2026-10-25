import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const execFile = vi.fn();
  (execFile as any)[Symbol.for('nodejs.util.promisify.custom')] = (...args: unknown[]) => new Promise((resolve, reject) => {
    execFile(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }));
  });
  return { execFile };
});
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
import { readWindowsSignature, verifyWindowsUpdateSignature } from '../windows-signature.js';

afterEach(() => { mocks.execFile.mockReset(); vi.unstubAllGlobals(); });
it('fails closed when the verifier process fails or produces invalid JSON', async () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(new Error('process failed')));
  expect(await verifyWindowsUpdateSignature(['CN=Fixture'], 'fixture.exe')).toBe('Windows signature verification could not be completed');
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(null, 'not JSON', ''));
  expect(await verifyWindowsUpdateSignature(['CN=Fixture'], 'fixture.exe')).not.toBeNull();
});
it('passes paths as data and verifies Unicode publisher names', async () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  const subject = 'CN=测试公司, O=测试公司';
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(null,
    JSON.stringify({ status: 'Valid', subject, issuer: 'Trusted CA', timestamped: true, codeSigning: true }), ''));
  const path = "fixture'; Write-Host injected; '.exe";
  expect(await verifyWindowsUpdateSignature([subject], path)).toBeNull();
  const [, args, options] = mocks.execFile.mock.calls[0];
  const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
  expect(script).not.toContain(path); expect(script).toContain('$env:XOPC_SIGNATURE_TARGET');
  expect(options.windowsHide).toBe(true); expect(options.env.XOPC_SIGNATURE_TARGET).toContain(path);
});
it('does not report a signature on unsupported platforms', async () => {
  vi.stubGlobal('process', { ...process, platform: 'linux' });
  await expect(readWindowsSignature('fixture.exe')).rejects.toThrow('requires Windows');
});
