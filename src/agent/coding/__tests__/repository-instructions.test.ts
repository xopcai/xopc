import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { RepositoryInstructions } from '../repository-instructions.js';

it('delivers scoped rules before edits and only acknowledges them at the next model request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repo-instructions-'));
  try {
    await mkdir(join(root, 'src/deep'), { recursive: true });
    await writeFile(join(root, 'AGENTS.md'), 'root rule');
    await writeFile(join(root, 'src/AGENTS.md'), 'source rule');
    const loader = await RepositoryInstructions.open(root);
    expect(await loader.load('.', true)).toContain('root rule'); loader.acknowledge();
    const patch = { patch: '*** Begin Patch\n*** Add File: src/deep/a.ts\n+x\n*** End Patch' };
    expect(await loader.forTool('apply_patch', patch)).toContain('source rule');
    expect(await loader.forTool('apply_patch', patch)).toContain('source rule');
    loader.acknowledge();
    expect(await loader.forTool('apply_patch', patch)).toBe('');
    await writeFile(join(root, 'src/AGENTS.md'), 'changed rule');
    expect(await loader.forTool('read_file', { path: 'src/deep/a.ts' })).toContain('changed rule');
    expect(await loader.forTool('read_file', { path: '../outside/a.ts' })).toBe('');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('loads batch paths and surfaces newly discovered nested search instructions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'batch-instructions-'));
  try {
    await mkdir(join(root, 'notes'));
    await writeFile(join(root, 'AGENTS.md'), 'root rule');
    await writeFile(join(root, 'notes/AGENTS.md'), 'Use the documented index before broad searches.');
    await writeFile(join(root, 'notes/a.md'), 'evidence');
    const loader = await RepositoryInstructions.open(root);
    expect(await loader.forTool('data_batch', { operations: [{ id: 's', kind: 'file_search', paths: ['.'], patterns: ['evidence'] }] })).toContain('root rule');
    loader.acknowledge();
    const result = [{ type: 'text', text: JSON.stringify({ schemaVersion: 1, operations: [], fragments: [{
      source: { kind: 'file', resource: join(root, 'notes/a.md') }, text: 'evidence', operationIds: ['s'],
    }] }) }];
    expect(await loader.forDataResult(result)).toContain('documented index');
    loader.acknowledge();
    expect(await loader.forDataResult(result)).toBe('');
    expect(await loader.forTool('data_batch', { operations: [{ id: 'r', kind: 'file_read', path: 'notes/a.md' }] })).toBe('');
  } finally { await rm(root, { recursive: true, force: true }); }
});
