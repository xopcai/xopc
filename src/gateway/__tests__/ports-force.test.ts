import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { forceFreePortAndWait } from '../ports.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('forceFreePortAndWait on Windows', () => {
  it('returns immediately after one scan when the port has no listeners', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.mocked(execFileSync).mockReturnValue('');
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);

    await expect(forceFreePortAndWait(18790)).resolves.toEqual({
      killed: [], waitedMs: 0, escalatedToSigkill: false,
    });

    expect(kill).not.toHaveBeenCalled();
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith('netstat', ['-ano', '-p', 'TCP'], {
      encoding: 'utf-8', windowsHide: true, timeout: 5000,
    });
  });

  it('still terminates a listener and waits for it to release the port', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.mocked(execFileSync)
      .mockReturnValueOnce('  TCP  127.0.0.1:18790  0.0.0.0:0  LISTENING  12345\r\n')
      .mockReturnValue('');
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);

    await expect(forceFreePortAndWait(18790, { intervalMs: 1 })).resolves.toEqual({
      killed: [{ pid: 12345 }], waitedMs: 1, escalatedToSigkill: false,
    });

    expect(kill).toHaveBeenCalledExactlyOnceWith(12345, 'SIGTERM');
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });
});
