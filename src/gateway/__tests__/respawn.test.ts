import { spawn } from 'node:child_process';
import { describe, it, expect, vi } from 'vitest';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { restartGatewayProcessWithFreshPid } from '../respawn.js';

describe('ProcessRespawn', () => {
  it('should return disabled when XOPC_NO_RESPAWN is set', () => {
    const originalValue = process.env.XOPC_NO_RESPAWN;
    process.env.XOPC_NO_RESPAWN = '1';
    
    try {
      const result = restartGatewayProcessWithFreshPid();
      expect(result.mode).toBe('disabled');
    } finally {
      if (originalValue !== undefined) {
        process.env.XOPC_NO_RESPAWN = originalValue;
      } else {
        delete process.env.XOPC_NO_RESPAWN;
      }
    }
  });

  it('should return supervised when supervisor hint is present', () => {
    const originalValue = process.env.INVOCATION_ID;
    process.env.INVOCATION_ID = 'test-invocation-id';
    
    try {
      const result = restartGatewayProcessWithFreshPid();
      expect(result.mode).toBe('supervised');
    } finally {
      if (originalValue !== undefined) {
        process.env.INVOCATION_ID = originalValue;
      } else {
        delete process.env.INVOCATION_ID;
      }
    }
  });
  it('detaches Windows restarts from parent console descriptors', () => {
    vi.stubEnv('XOPC_NO_RESPAWN', '');
    for (const name of ['LAUNCH_JOB_LABEL', 'LAUNCH_JOB_NAME', 'INVOCATION_ID', 'SYSTEMD_EXEC_PID', 'JOURNAL_STREAM', 'XOPC_SERVICE_MARKER']) vi.stubEnv(name, '');
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const unref = vi.fn();
    vi.mocked(spawn).mockReturnValue({ pid: 123, unref } as unknown as ReturnType<typeof spawn>);
    try {
      expect(restartGatewayProcessWithFreshPid()).toEqual({ mode: 'spawned', pid: 123 });
      expect(spawn).toHaveBeenCalledWith(process.execPath, expect.any(Array), expect.objectContaining({ stdio: 'ignore', windowsHide: true, detached: true }));
      expect(unref).toHaveBeenCalledOnce();
    } finally { vi.restoreAllMocks(); vi.unstubAllEnvs(); }
  });

});
