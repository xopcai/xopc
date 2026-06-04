import { describe, expect, it } from 'vitest';

import { buildWorkflowAgentExecutionBlocks } from '../workflow-agent-execution-blocks';
import type { WorkflowAgentSnapshot } from '../workflow.types';

describe('buildWorkflowAgentExecutionBlocks', () => {
  it('maps tool steps to tool_use blocks for the chat timeline', () => {
    const agent: WorkflowAgentSnapshot = {
      id: 1,
      label: 'review',
      prompt: 'check code',
      status: 'running',
      steps: [
        {
          id: 'tc-1',
          kind: 'tool',
          toolName: 'read_file',
          label: 'Read file',
          detail: 'src/foo.ts',
          status: 'done',
        },
      ],
    };
    const blocks = buildWorkflowAgentExecutionBlocks(agent);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('tool_use');
    if (blocks[0].type === 'tool_use') {
      expect(blocks[0].name).toBe('read_file');
      expect(blocks[0].input).toEqual({ path: 'src/foo.ts' });
      expect(blocks[0].status).toBe('done');
    }
  });

  it('appends stream text as a thinking block', () => {
    const agent: WorkflowAgentSnapshot = {
      id: 1,
      label: 'x',
      prompt: 'p',
      status: 'running',
      streamText: 'Analyzing…',
    };
    const blocks = buildWorkflowAgentExecutionBlocks(agent);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'thinking', text: 'Analyzing…', streaming: true });
  });
});
