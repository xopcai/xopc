import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createLanguageDiagnosticsTool } from '../language-diagnostics.js';

it('runs the installed compiler and returns source locations rather than claiming an unavailable check passed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'language-check-'));
  try {
    const tool = createLanguageDiagnosticsTool(root);
    await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true,"skipLibCheck":true},"files":["a.ts"]}');
    await expect(tool.execute('missing', {})).rejects.toThrow('no installed TypeScript');
    await mkdir(join(root, 'node_modules'));
    await symlink(await realpath(resolve('node_modules/typescript')), join(root, 'node_modules/typescript'), 'dir');
    await writeFile(join(root, 'a.ts'), 'const count: number = "wrong";');
    const failed = await tool.execute('bad', {});
    expect(failed.details.exitCode).not.toBe(0);
    expect(failed.details.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ line: 1, code: 'TS2322' })]));
    await writeFile(join(root, 'a.ts'), 'const count: number = 1;');
    expect((await tool.execute('good', {})).details.exitCode).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
