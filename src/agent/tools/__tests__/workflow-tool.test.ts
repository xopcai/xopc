import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkflowTool } from '../workflow-tool.js';

const mocks = vi.hoisted(() => ({
  runWorkflow: vi.fn(),
}));

vi.mock('../../workflow/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../workflow/index.js')>('../../workflow/index.js');
  return {
    ...actual,
    DelegateSubagentRunner: class DelegateSubagentRunner {},
    getLastWorkflowMemory: () => ({ record: vi.fn() }),
    runWorkflow: mocks.runWorkflow,
  };
});

describe('workflow tool progress updates', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not emit throttled progress from a timer callback', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    mocks.runWorkflow.mockImplementation(async (_script: string, _deps: unknown, options: any) => {
      options.onLog('queued');
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        meta: { name: 'demo', description: 'Demo workflow' },
        agentCount: 1,
        durationMs: 10,
        result: 'ok',
      };
    });

    const tool = createWorkflowTool({
      workspace: '/tmp/xopc-test',
      bus: {} as any,
      getSubagentModel: () => ({}) as any,
      getConfig: () => ({ agents: { defaults: { workflow: { defaultTimeoutSec: 0 } } } }) as any,
      buildChildTools: () => [],
      catalog: { load: vi.fn() } as any,
    });

    const updates: unknown[] = [];
    const executePromise = tool.execute(
      'tool-call-1',
      {
        script: `export const meta = { name: 'demo', description: 'Demo workflow' }
log('start')
const result = await agent('work')
return result`,
      },
      undefined,
      (update) => updates.push(update),
    );

    await vi.advanceTimersByTimeAsync(300);
    expect(updates).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(200);
    await executePromise;

    expect(updates).toHaveLength(2);
  });

  it('keeps the workflow result when the host rejects live progress updates', async () => {
    mocks.runWorkflow.mockImplementation(async (_script: string, _deps: unknown, options: any) => {
      options.onAgentQueued({ id: 1, label: 'bugs review', prompt: 'review bugs' });
      options.onAgentStart({ id: 1, label: 'bugs review', prompt: 'review bugs' });
      options.onAgentEnd({ id: 1, label: 'bugs review', result: null, status: 'error' });
      return {
        meta: { name: 'demo', description: 'Demo workflow' },
        agentCount: 1,
        durationMs: 10,
        result: 'ok',
      };
    });

    const tool = createWorkflowTool({
      workspace: '/tmp/xopc-test',
      bus: {} as any,
      getSubagentModel: () => ({}) as any,
      getConfig: () => ({ agents: { defaults: { workflow: { defaultTimeoutSec: 0 } } } }) as any,
      buildChildTools: () => [],
      catalog: { load: vi.fn() } as any,
    });

    let updateCount = 0;
    const result = await tool.execute(
      'tool-call-1',
      {
        script: `export const meta = { name: 'demo', description: 'Demo workflow' }
const result = await agent('work')
return result`,
      },
      undefined,
      () => {
        updateCount += 1;
        throw new Error('Agent listener invoked outside active run');
      },
    );

    expect(updateCount).toBe(1);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('workflow demo completed');
  });
});
