import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { windowsDatabaseOwners } from '../migrations/conversation-windows-owners.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFileSync: vi.fn(),
}));

describe('windowsDatabaseOwners', () => {
  const directories: string[] = [];

  afterEach(() => {
    vi.mocked(execFileSync).mockReset();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses an unambiguous native FILETIME layout and preserves Unicode paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-数据库-'));
    directories.push(directory);
    const databasePath = join(directory, '会话.db');
    writeFileSync(databasePath, '');
    vi.mocked(execFileSync).mockReturnValue(`41\n${process.pid}\n73\n`);

    expect(windowsDatabaseOwners(databasePath)).toEqual(['41', '73']);

    const [executable, args, options] = vi.mocked(execFileSync).mock.calls[0]!;
    expect(executable).toBe('powershell.exe');
    expect(args).toEqual(expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command']));
    const script = String(args?.at(-1));
    expect(script).toContain('struct NativeFileTime { public uint Low; public uint High; }');
    expect(script).toContain('public NativeFileTime StartedAt;');
    expect(script).not.toContain('using System.Runtime.InteropServices.ComTypes;');
    expect(script).not.toContain('public FILETIME StartedAt;');
    expect(JSON.parse(String(options?.env?.XOPC_CUTOVER_DATABASE_FILES))).toEqual([
      resolve(databasePath),
    ]);
  });
});
