import { execFileSync } from 'node:child_process';
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Type } from '@sinclair/typebox';

import { createDataBatchTool, withDataToolPermissions } from '../dataBatch.js';
import { acquireData } from '../../data-acquisition/service.js';
import { renderDataBatch } from '../../data-acquisition/render.js';
import { dataOperationCalls } from '../../data-acquisition/schema.js';
import { truncateToolResultMessage } from '../../embedded/tool-result-truncation.js';

let root: string;
const allowed = new Set(['read_file', 'grep']);
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'data-batch-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('data_batch', () => {
  it('exposes valid individual search arguments to authorization and quotas', () => {
    const calls = dataOperationCalls({ operations: [{ id: 's', kind: 'file_search', paths: ['a', 'b'], patterns: ['x', 'y'], literal: true }] });
    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual({ name: 'grep', args: { path: 'a', pattern: 'x', literal: true, glob: undefined, ignoreCase: undefined, context: 2 } });
  });

  it('limits a batch to four active requests even across independent hosts', async () => {
    let active = 0, peak = 0;
    const execute = vi.fn(async () => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return { content: [{ type: 'text' as const, text: 'page' }], details: { complete: true } };
    });
    const result = await acquireData(root, { operations: Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, kind: 'web_fetch' as const, url: `https://host${i}.example/page` })) }, new Set(['web_fetch']), undefined,
      { getTools: () => [{ name: 'web_fetch', label: 'Web', description: '', parameters: Type.Object({}), execute }] });
    expect(peak).toBe(4);
    expect(result.operations.every(op => op.status === 'ok')).toBe(true);
    expect(execute).toHaveBeenCalledTimes(8);
  });

  it('shares one file read while retaining independent ranges and continuation', async () => {
    await writeFile(join(root, 'meeting.md'), 'one\ntwo\nthree\nfour');
    const result = await acquireData(root, { operations: [
      { id: 'a', kind: 'file_read', path: 'meeting.md', startLine: 1, maxLines: 2 },
      { id: 'b', kind: 'file_read', path: './meeting.md', startLine: 3 },
      { id: 'c', kind: 'file_read', path: 'meeting.md', startLine: 1, maxLines: 2 },
    ] }, allowed);
    expect(result.sourceRequests).toBe(1);
    expect(result.fragments).toHaveLength(2);
    expect(result.fragments[0]).toMatchObject({ operationIds: ['a', 'c'], startLine: 1, endLine: 2, text: 'one\ntwo' });
    expect(result.operations[0]).toMatchObject({ status: 'ok', next: { startLine: 3 }, sourceExhausted: false });
    expect(result.operations[1]).toMatchObject({ status: 'ok', sourceExhausted: true });
  });

  it('preserves successful items when another item is missing or denied', async () => {
    await writeFile(join(root, 'ok.md'), 'decision');
    const result = await acquireData(root, { operations: [
      { id: 'good', kind: 'file_read', path: 'ok.md' },
      { id: 'missing', kind: 'file_read', path: 'missing.md' },
      { id: 'denied', kind: 'file_search', paths: ['.'], patterns: ['decision'] },
    ] }, new Set(['read_file']));
    expect(result.operations.map(op => op.status)).toEqual(['ok', 'error', 'denied']);
    expect(result.fragments[0]?.text).toBe('decision');
  });

  it('intersects runtime tools with factory permissions for workflow and child execution', async () => {
    await writeFile(join(root, 'ok.md'), 'private');
    const tool = createDataBatchTool(root, () => allowed);
    const result = await withDataToolPermissions(new Set(['data_batch']), () => tool.execute('x', {
      operations: [{ id: 'a', kind: 'file_read', path: 'ok.md' }],
    }));
    expect(result.content).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('private') })]));
    expect(result.details).toMatchObject({ sourceRequests: 0, status: 'failed' });
  });

  it('validates the whole envelope before any reads', async () => {
    for (const operations of [
      [{ id: 'a', kind: 'file_read', path: 'x', command: 'touch x' }],
      [{ id: 'a', kind: 'file_read', path: 'x' }, { id: 'a', kind: 'file_read', path: 'y' }],
    ]) await expect(acquireData(root, { operations } as never, allowed)).rejects.toThrow();
  });

  it('does not read protected files, hard links, escaping links or binary files', async () => {
    await writeFile(join(root, '.env'), 'SECRET');
    await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2]));
    await writeFile(join(root, 'original'), 'secret');
    await link(join(root, 'original'), join(root, 'hard'));
    await symlink('/etc/passwd', join(root, 'escape'));
    const result = await acquireData(root, { operations: ['.env', 'binary', 'hard', 'escape'].map((path, i) => ({
      id: `r${i}`, kind: 'file_read', path,
    })) }, allowed);
    expect(result.fragments).toEqual([]);
    expect(result.operations.every(op => op.status !== 'ok')).toBe(true);
  });

  it('searches OR patterns literally and respects ignored files', async () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    await mkdir(join(root, 'generated'));
    await writeFile(join(root, '.gitignore'), 'generated/\n');
    await writeFile(join(root, 'generated/noise.md'), '--flag');
    await writeFile(join(root, 'notes.md'), '--flag\nsecond\nlast');
    const result = await acquireData(root, { operations: [{ id: 's', kind: 'file_search',
      paths: ['.'], patterns: ['--flag', 'second'], literal: true, contextLines: 0,
    }] }, allowed);
    expect(result.operations[0]).toMatchObject({ status: 'ok', sourceExhausted: true });
    expect(result.fragments.map(f => f.text).join('\n')).toContain('--flag\nsecond');
    expect(JSON.stringify(result.fragments)).not.toContain('generated');
  });

  it('renders all item statuses, valid JSON and omissions after context reduction', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => writeFile(join(root, `${i}.md`), `decision-${i}\n${'evidence\n'.repeat(499)}`)));
    const result = await acquireData(root, { operations: Array.from({ length: 8 }, (_, i) => ({
      id: `r${i}`, kind: 'file_read', path: `${i}.md`, maxLines: 500,
    })) }, allowed);
    const rendered = renderDataBatch(result);
    expect(rendered.text.length).toBeLessThanOrEqual(12_000);
    for (let i = 0; i < 8; i++) expect(rendered.text).toContain(`decision-${i}`);
    const message = truncateToolResultMessage({ role: 'toolResult', toolName: 'data_batch', content: [{ type: 'text', text: rendered.text }] } as never, 4000) as any;
    const limited = JSON.parse(message.content[0].text);
    expect(message.content[0].text.length).toBeLessThanOrEqual(4000);
    expect(limited.operations).toHaveLength(8);
    expect(limited.operations.every((op: any) => op.outputOmitted && op.status === 'partial')).toBe(true);
    for (const operation of rendered.result.operations) {
      const fragment = rendered.result.fragments.find(item => item.operationIds.includes(operation.id));
      expect(operation.next?.startLine).toBe(fragment!.endLine! + 1);
    }
  });

  it('does not drop later files because the first file has long lines', async () => {
    await writeFile(join(root, 'a.md'), `needle ${'x'.repeat(10000)}\n`);
    await writeFile(join(root, 'b.md'), 'needle important');
    const result = await acquireData(root, { operations: [{ id: 's', kind: 'file_search', paths: ['.'], patterns: ['needle'] }] }, allowed);
    expect(result.fragments.some(f => f.text === 'needle important')).toBe(true);
    expect(result.operations[0]).toMatchObject({ status: 'partial', outputOmitted: true });
  });

  it('does not start work after cancellation', async () => {
    const signal = AbortSignal.abort();
    await expect(acquireData(root, { operations: [{ id: 'a', kind: 'file_read', path: 'x' }] }, allowed, signal)).rejects.toThrow();
  });

  it('reads Git history and blobs without including unmerged branch commits', async () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q');
    await writeFile(join(root, 'decision.md'), 'agreed');
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'public-decision');
    const head = git('rev-parse', 'HEAD');
    const branch = git('branch', '--show-current');
    git('checkout', '-qb', 'unmerged');
    await writeFile(join(root, 'decision.md'), 'different');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-am', 'unmerged-secret', '-q');
    git('checkout', '-q', branch);
    const result = await acquireData(root, { operations: [
      { id: 'history', kind: 'git_recent' },
      { id: 'blob', kind: 'git_read', path: 'decision.md', commit: head },
    ] }, new Set(['exec_command', 'read_file']));
    expect(result.operations.map(op => op.status)).toEqual(['ok', 'ok']);
    expect(JSON.stringify(result)).toContain('public-decision');
    expect(JSON.stringify(result)).not.toContain('unmerged-secret');
    expect(result.fragments.some(fragment => fragment.text === 'agreed')).toBe(true);
    const denied = await acquireData(root, { operations: [{ id: 'g', kind: 'git_recent' }] }, new Set(['exec_command']), undefined, { allowHostGit: () => false });
    expect(denied.operations[0].status).toBe('denied');
    expect(denied.sourceRequests).toBe(0);
  });

  it('delegates trusted sources through their existing tools and preserves errors', async () => {
    const execute = vi.fn(async (_id, args) => ({ content: [{ type: 'text' as const, text: JSON.stringify(args) }], details: { complete: true } }));
    const tools = [{ name: 'knowledge_get', label: 'Knowledge', description: '', parameters: Type.Object({ id: Type.String() }), execute }];
    const result = await acquireData(root, { operations: [{ id: 'k', kind: 'knowledge_get', knowledgeId: 'record-1' }] }, new Set(['knowledge_get']), undefined, { getTools: () => tools });
    expect(execute).toHaveBeenCalledWith('k', { id: 'record-1' }, expect.any(AbortSignal));
    expect(result.operations[0]).toMatchObject({ status: 'ok', sourceExhausted: true });
    execute.mockResolvedValueOnce({ content: [], details: { error: 'permission denied' } } as never);
    const failed = await acquireData(root, { operations: [{ id: 'k', kind: 'knowledge_get', knowledgeId: 'record-1' }] }, new Set(['knowledge_get']), undefined, { getTools: () => tools });
    expect(failed.operations[0].status).toBe('error');
  });

  it('forces the external read guard and retains the exact contract and account', async () => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'mail' }], details: {} }));
    await acquireData(root, { operations: [{ id: 'e', kind: 'external_read', toolRef: 'composio:gmail:profile', revision: 'rev', arguments: { xopcAccountId: 'a' } }] }, new Set(['xopc_tool_execute']), undefined,
      { getTools: () => [{ name: 'xopc_tool_execute', label: 'External', description: '', parameters: Type.Object({}), execute }] });
    expect(execute).toHaveBeenCalledWith('e', { toolRef: 'composio:gmail:profile', revision: 'rev', arguments: { xopcAccountId: 'a' }, readOnly: true }, expect.any(AbortSignal));
    const result = await acquireData(root, { operations: ['a', 'b'].map(account => ({ id: account, kind: 'external_read' as const,
      toolRef: 'composio:gmail:profile', revision: 'rev', arguments: { xopcAccountId: account } })) }, new Set(['xopc_tool_execute']), undefined,
      { getTools: () => [{ name: 'xopc_tool_execute', label: 'External', description: '', parameters: Type.Object({}), execute }] });
    expect(result.fragments).toHaveLength(2);
    expect(result.fragments.map(fragment => fragment.source.revision)).toEqual(['rev', 'rev']);
    expect(result.fragments[0].source.resource).not.toBe(result.fragments[1].source.resource);
  });

  it('cancels in-flight file reads without returning a success result', async () => {
    await writeFile(join(root, 'large.md'), 'x'.repeat(8 * 1024 * 1024));
    const controller = new AbortController();
    const pending = acquireData(root, { operations: [{ id: 'a', kind: 'file_read', path: 'large.md' }] }, allowed, controller.signal);
    setTimeout(() => controller.abort(), 0);
    const result = await pending;
    expect(result.operations[0].status).toBe('cancelled');
    expect(result.fragments).toEqual([]);
  });
});
