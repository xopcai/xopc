import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';

import { retainCodemodeOutput } from '../codemode-output.js';

it('retains real pi output in the workspace and rejects arbitrary and symlinked paths', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'xopc-output-test-'));
  const source = join(tmpdir(), `pi-codemode-${randomBytes(8).toString('hex')}.txt`);
  const linked = join(tmpdir(), `pi-codemode-${randomBytes(8).toString('hex')}.txt`);
  try {
    await writeFile(source, 'full output evidence', { mode: 0o600 });
    const path = await retainCodemodeOutput(workspace, source);
    expect(path).toMatch(/^\.xopc\/codemode-output\/.*\.txt$/);
    expect(await readFile(join(workspace, path!), 'utf8')).toBe('full output evidence');
    expect(await retainCodemodeOutput(workspace, '/etc/passwd')).toBeUndefined();
    await symlink(source, linked);
    await expect(retainCodemodeOutput(workspace, linked)).rejects.toThrow();
  } finally { await Promise.all([rm(workspace, { recursive: true, force: true }), rm(source, { force: true }), rm(linked, { force: true })]); }
});
