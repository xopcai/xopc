import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createGrepTool } from '../grep.js';
import { createFindTool } from '../find.js';
import { createReadFileTool } from '../read.js';
const output = (result: any) => result.content.map((block: any) => block.text ?? '').join('\n');

it('respects ignores, handles literal flags safely, and reads later file sections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repo-search-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    await mkdir(join(root, 'generated')); await mkdir(join(root, 'src'));
    await writeFile(join(root, '.gitignore'), 'generated/\n');
    await writeFile(join(root, 'generated/large.ts'), 'needle');
    await writeFile(join(root, 'src/a.ts'), 'one\nneedle\n--help\nfour\nfive');
    const found = output(await createFindTool(root).execute('f', { pattern: '*.ts' }));
    expect(found).toContain('src/a.ts'); expect(found).not.toContain('generated');
    const grep = createGrepTool(root);
    expect(output(await grep.execute('g', { pattern: '--help', literal: true }))).toContain('a.ts:3:');
    expect(output(await grep.execute('g', { pattern: 'needle' }))).not.toContain('generated');
    await expect(grep.execute('g', { pattern: '[' })).rejects.toThrow();
    const read = await createReadFileTool(root).execute('r', { path: 'src/a.ts', offset: 4, limit: 1 });
    expect(output(read)).toContain('four'); expect(output(read)).not.toContain('needle'); expect(output(read)).toContain('offset=5');
  } finally { await rm(root, { recursive: true, force: true }); }
});
