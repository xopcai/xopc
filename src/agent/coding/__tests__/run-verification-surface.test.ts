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
