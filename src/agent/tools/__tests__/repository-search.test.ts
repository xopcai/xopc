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
    await writeFile(join(root, 'src/long.txt'), Array.from({ length: 600 }, (_, i) => `line-${i}`).join('\n'));
    const bounded = createReadFileTool(root, { defaultMaxLines: 150, maxOutputBytes: 8000 });
    const first = await bounded.execute('first', { path: 'src/long.txt' });
    expect(output(first)).toContain('continue with offset=151');
    expect(output(first)).not.toContain('line-150');
    expect(output(await bounded.execute('next', { path: 'src/long.txt', offset: 151, limit: 1 }))).toContain('line-150');
    await writeFile(join(root, 'src/big.txt'), 'x'.repeat(20000));
    const large = await createReadFileTool(root, { maxReadBytes: 12000, maxOutputBytes: 8000 })
      .execute('large', { path: 'src/big.txt' });
    expect(large.details).toMatchObject({ requiresSpecialist: true, size: 20000, reason: 'large_file' });
    expect(output(large)).not.toContain('x'.repeat(100));
    expect(output(large)).toContain('delegate reading and processing');
  } finally { await rm(root, { recursive: true, force: true }); }
});
