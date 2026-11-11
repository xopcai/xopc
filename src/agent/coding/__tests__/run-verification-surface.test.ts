import type { AfterToolCallContext } from '@earendil-works/pi-agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(async () => 'revision') }));
vi.mock('../workspace-revision.js', () => ({ readWorkspaceRevision: mocks.snapshot }));

import { RunVerification } from '../run-verification.js';

describe('workspace verification tracking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not inspect Git for a surface that cannot mutate the workspace', async () => {
    const run = await RunVerification.open('/workspace', {
      required: false, trackWorkspace: false, toolNames: ['personal_task', 'read_file'],
    });
    await run.summary();
    await run.beforeTool('submit', 'personal_task');
    await run.afterTool({ toolCall: { id: 'submit', name: 'personal_task' }, args: {},
      result: { content: [], details: {} }, isError: false } as unknown as AfterToolCallContext);
    expect(await run.pendingContext()).toBe('');
    expect(await run.summary()).toMatchObject({ changed: false, revision: undefined, evidence: [] });
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it('reuses the opening revision and still refreshes the terminal evidence', async () => {
    mocks.snapshot.mockResolvedValueOnce('start').mockResolvedValueOnce('after-external-change');
    const run = await RunVerification.open('/workspace', { required: false });
    expect(run.capturedSummary()).toMatchObject({ revision: 'start', changed: false });
    expect(await run.pendingContext()).toBe('');
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(await run.summary()).toMatchObject({ revision: 'after-external-change', changed: true });
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('skips Git for text and read-only turns with required=%s', async required => {
    const run = await RunVerification.open('/workspace', { required, deferWorkspaceSnapshot: true });
    const checkpoint = vi.fn();
    await run.beforeTool('read', 'read_file', checkpoint);
    await run.afterTool({ toolCall: { id: 'read', name: 'read_file' }, args: {},
      result: { content: [], details: {} }, isError: false } as unknown as AfterToolCallContext);
    expect(await run.pendingContext()).toBe('');
    expect(await run.summary()).toMatchObject({ changed: false, revision: undefined, evidence: [] });
    expect(checkpoint).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it('checkpoints one baseline before parallel tools and detects interrupted changes from it', async () => {
    mocks.snapshot.mockResolvedValueOnce('before-write').mockResolvedValueOnce('after-write');
    const run = await RunVerification.open('/workspace', { deferWorkspaceSnapshot: true });
    const checkpoint = vi.fn();
    const execute = vi.fn(() => {
      expect(checkpoint).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ changed: false, revision: 'before-write' }));
    });
    await Promise.all([
      run.beforeTool('write', 'write_file', checkpoint).then(execute),
      run.beforeTool('extension', 'extension_tool', checkpoint).then(execute),
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);

    const resumed = await RunVerification.open('/workspace');
    resumed.restore(checkpoint.mock.calls[0]?.[0], false);
    expect(resumed.capturedSummary()).toMatchObject({ changed: true, revision: 'after-write', evidence: [] });
  });

  it.each([
    { required: true, trackWorkspace: false },
    { required: false },
    {},
  ])('retains snapshots for required verification or default tracking: %j', async options => {
    const run = await RunVerification.open('/workspace', options);
    expect(await run.summary()).toMatchObject({ revision: 'revision' });
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
  });
});
