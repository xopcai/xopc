import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';

import { createManagedJobTool } from '../managed-job-tool.js';

function text(result: Awaited<ReturnType<ReturnType<typeof createManagedJobTool>['execute']>>): any {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe('managed_job tool', () => {
  it('exposes an object-rooted schema while preserving action-specific requirements', () => {
    const tool = createManagedJobTool(process.cwd(), () => 'session-a');

    expect(tool.parameters).toMatchObject({ type: 'object', anyOf: expect.any(Array) });
    expect(Value.Check(tool.parameters, { action: 'start', command: 'echo ok' })).toBe(true);
    expect(Value.Check(tool.parameters, { action: 'start' })).toBe(false);
    expect(Value.Check(tool.parameters, { action: 'status', jobId: 'job-1' })).toBe(true);
    expect(Value.Check(tool.parameters, { action: 'status' })).toBe(false);
    expect(Value.Check(tool.parameters, { action: 'list' })).toBe(true);
  });

  it('starts a job without blocking the tool call and exposes its terminal output', async () => {
    const tool = createManagedJobTool(process.cwd(), () => 'session-a');
    const startedAt = Date.now();
    const started = text(await tool.execute('start', {
      action: 'start',
      command: `node -e "setTimeout(() => console.log('managed-ok'), 50)"`,
      maxRuntimeMs: 5_000,
    }));

    expect(started.status).toBe('running');
    expect(Date.now() - startedAt).toBeLessThan(1_000);

    let current = started;
    const deadline = Date.now() + 3_000;
    while (current.status === 'running' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = text(await tool.execute('status', { action: 'status', jobId: started.id }));
    }
    expect(current).toMatchObject({ status: 'success', exitCode: 0 });
    expect(current.stdout).toContain('managed-ok');
  });

  it('scopes job visibility by session and cancels a running process', async () => {
    const owner = createManagedJobTool(process.cwd(), () => 'session-owner');
    const outsider = createManagedJobTool(process.cwd(), () => 'session-other');
    const started = text(await owner.execute('start', {
      action: 'start',
      command: `node -e "setTimeout(() => {}, 10000)"`,
      maxRuntimeMs: 20_000,
    }));

    expect(text(await outsider.execute('status', { action: 'status', jobId: started.id })))
      .toMatchObject({ status: 'failed', error: 'Managed job not found' });
    expect(text(await owner.execute('cancel', { action: 'cancel', jobId: started.id })))
      .toMatchObject({ status: 'cancelled' });
  });
});
