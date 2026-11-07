import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('OSWorld JSONL bridge offline boundary', () => {
  it('rejects malformed input before credential resolution without echoing input or a stack', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/osworld/model-bridge.mts'], {
      input: 'untrusted-private-input\n', encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false' },
    });
    expect(result.status, result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, errorCode: 'OSWORLD_BRIDGE_FAILED', modelRequests: 0 });
    expect(result.stdout + result.stderr).not.toContain('untrusted-private-input');
    expect(result.stderr).toBe('');
  }, 70_000);
});
