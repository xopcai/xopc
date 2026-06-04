import { describe, expect, it } from 'vitest';

import { applySubagentProgress } from '../agent-progress.js';
import type { WorkflowAgentSnapshot } from '../types.js';

function mkAgent(over: Partial<WorkflowAgentSnapshot> = {}): WorkflowAgentSnapshot {
  return {
    id: 1,
    label: 'test',
    prompt: 'do work',
    status: 'running',
    startedAtMs: Date.now(),
    ...over,
  };
}

describe('applySubagentProgress', () => {
  it('records tool steps and currentStep', () => {
    const agent = mkAgent();
    expect(
      applySubagentProgress(agent, {
        type: 'tool_start',
        toolCallId: 'tc-1',
        toolName: 'read_file',
        args: { path: 'src/foo.ts' },
      }),
    ).toBe(true);
    expect(agent.steps).toHaveLength(1);
    expect(agent.steps?.[0].label).toBe('Read file');
    expect(agent.steps?.[0].detail).toBe('src/foo.ts');
    expect(agent.currentStep).toContain('Read file');

    expect(
      applySubagentProgress(agent, {
        type: 'tool_end',
        toolCallId: 'tc-1',
        toolName: 'read_file',
        isError: false,
      }),
    ).toBe(true);
    expect(agent.steps?.[0].status).toBe('done');
    expect(agent.currentStep).toBeUndefined();
  });

  it('appends stream text for text_delta', () => {
    const agent = mkAgent();
    applySubagentProgress(agent, { type: 'text_delta', delta: 'hello ' });
    applySubagentProgress(agent, { type: 'text_delta', delta: 'world' });
    expect(agent.streamText).toBe('hello world');
  });

  it('tracks iteration counts', () => {
    const agent = mkAgent();
    applySubagentProgress(agent, { type: 'iteration', count: 2, max: 30 });
    expect(agent.iteration).toBe(2);
    expect(agent.maxIterations).toBe(30);
  });
});
