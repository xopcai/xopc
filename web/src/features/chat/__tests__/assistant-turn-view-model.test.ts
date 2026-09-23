import { describe, expect, it } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
import { buildAssistantTurnViewModel } from '@/features/chat/messages/assistant-turn-view-model';

function assistantMessage(content: Message['content']): Message {
  return { role: 'assistant', content, timestamp: 1_000 };
}

describe('buildAssistantTurnViewModel', () => {
  it('prioritizes a running tool over pre-tool assistant text', () => {
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([
        { type: 'text', text: 'I will inspect the project.' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read_file',
          status: 'running',
          startedAt: 2_000,
        },
      ]),
      isStreaming: true,
      reasoningLevel: 'stream',
    });

    expect(view.answer.started).toBe(true);
    expect(view.answer.showStreamingCursor).toBe(false);
    expect(view.lifecycle.state).toBe('using_tool');
    expect(view.lifecycle.activeTool?.name).toBe('read_file');
  });

  it('keeps tool activity visible in concise mode while hiding reasoning', () => {
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([
        { type: 'thinking', text: 'private analysis', streaming: false },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read_file',
          status: 'error',
          startedAt: 2_000,
          completedAt: 2_500,
        },
        { type: 'text', text: 'Done.' },
      ]),
      isStreaming: false,
      reasoningLevel: 'off',
    });

    expect(view.workLog.items.some((block) => block.type === 'thinking')).toBe(false);
    expect(view.workLog.items).toHaveLength(1);
    expect(view.workLog.status).toBe('completed');
    expect(view.workLog.expandedByDefault).toBe(false);
    expect(view.workLog.durationMs).toBe(1_500);
  });

  it('retains a structured tool failure without downgrading a completed turn', () => {
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([{
        type: 'tool_use',
        id: 'memory-1',
        name: 'memory_search',
        status: 'done',
        activity: {
          category: 'memory', action: 'search', status: 'failed', source: 'memory', sensitivity: 'personal',
        },
      }]),
      isStreaming: false,
      reasoningLevel: 'stream',
    });

    expect(view.lifecycle.state).toBe('completed');
    expect(view.workLog.status).toBe('completed');
  });

  it('opens live reasoning and moves the cursor to the answer once text starts', () => {
    const reasoning = buildAssistantTurnViewModel({
      message: assistantMessage([
        { type: 'thinking', text: 'working', streaming: true },
      ]),
      isStreaming: true,
      reasoningLevel: 'stream',
    });

    expect(reasoning.lifecycle.state).toBe('reasoning');
    expect(reasoning.workLog.active).toBe(true);
    expect(reasoning.workLog.expandedByDefault).toBe(true);
    expect(reasoning.answer.showStreamingCursor).toBe(false);

    const answering = buildAssistantTurnViewModel({
      message: assistantMessage([
        { type: 'thinking', text: 'working', streaming: false },
        { type: 'text', text: 'Final answer' },
      ]),
      isStreaming: true,
      reasoningLevel: 'stream',
    });

    expect(answering.lifecycle.state).toBe('answering');
    expect(answering.workLog.expandedByDefault).toBe(false);
    expect(answering.answer.showStreamingCursor).toBe(true);
  });

  it('normalizes stale running blocks after the stream closes', () => {
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read_file',
          status: 'running',
          startedAt: 2_000,
        },
      ]),
      isStreaming: false,
      reasoningLevel: 'stream',
    });

    expect(view.lifecycle.state).toBe('completed');
    expect(view.lifecycle.activeTool).toBeUndefined();
    expect(view.workLog.active).toBe(false);
  });

  it('keeps the activity round live between completed tools while the run is streaming', () => {
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([{
        type: 'tool_use',
        id: 'tool-1',
        name: 'read_file',
        status: 'done',
        startedAt: 2_000,
        completedAt: 2_500,
      }]),
      isStreaming: true,
      reasoningLevel: 'stream',
    });

    expect(view.lifecycle.state).toBe('starting');
    expect(view.workLog.active).toBe(true);
    expect(view.workLog.startedAt).toBe(1_000);
  });

  it('freezes completed activity at the observed end of the run', () => {
    const message = assistantMessage([{
      type: 'tool_use',
      id: 'tool-1',
      name: 'read_file',
      status: 'done',
      startedAt: 2_000,
      completedAt: 2_500,
    }]);
    message.completedAt = 5_000;

    const view = buildAssistantTurnViewModel({
      message,
      isStreaming: false,
      reasoningLevel: 'stream',
    });

    expect(view.workLog.active).toBe(false);
    expect(view.workLog.durationMs).toBe(4_000);
  });

  it('times narration-only work from the assistant message lifecycle', () => {
    const message = assistantMessage([
      { type: 'text', text: 'Checking the request.', presentation: 'narration' },
      { type: 'text', text: 'Done.', presentation: 'answer' },
    ]);
    message.completedAt = 4_000;

    const view = buildAssistantTurnViewModel({
      message,
      isStreaming: false,
      reasoningLevel: 'on',
    });

    expect(view.workLog.startedAt).toBe(1_000);
    expect(view.workLog.durationMs).toBe(3_000);
  });

  it('uses the structured outcome instead of inferring deliverables from write tools', () => {
    const message = assistantMessage([
      {
        type: 'tool_use',
        id: 'search-1',
        name: 'web_search',
        status: 'done',
        result: JSON.stringify({
          results: [{ url: 'https://example.com', title: 'Example' }],
        }),
      },
      {
        type: 'tool_use',
        id: 'write-1',
        name: 'write_file',
        status: 'done',
        result: 'File written: /tmp/report.md',
      },
      {
        type: 'tool_use',
        id: 'failed-1',
        name: 'run_command',
        status: 'error',
      },
    ]);
    message.outcome = {
      version: 1,
      outcomeId: 'run-1:outcome',
      runId: 'run-1',
      turnId: 'run-1',
      status: 'partial',
      deliverables: [],
      changeSet: {
        changeSetId: 'run-1:changes',
        files: [{ path: 'report.md', status: 'modified' }],
        added: 2,
        removed: 1,
        diff: 'diff',
        environment: 'workspace',
      },
      evidence: [],
      createdAt: '2026-09-01T00:00:00.000Z',
    };
    const view = buildAssistantTurnViewModel({
      message,
      isStreaming: false,
      reasoningLevel: 'stream',
    });

    expect(view.sources).toEqual([
      expect.objectContaining({ url: 'https://example.com', title: 'Example' }),
    ]);
    expect(view.outcome?.deliverables).toEqual([]);
    expect(view.outcome?.changeSet?.files).toEqual([{ path: 'report.md', status: 'modified' }]);
    expect(view.lifecycle.state).toBe('partial');
    expect(view.workLog.status).toBe('partial');
  });

  it('does not render a structured deliverable again as a standalone attachment', () => {
    const message = assistantMessage([]);
    message.attachments = [{
      id: 'artifact-1',
      name: 'report.pdf',
      type: 'file',
      uri: 'media://artifact-1',
    }];
    message.outcome = {
      version: 1,
      outcomeId: 'run-1:outcome',
      runId: 'run-1',
      turnId: 'run-1',
      status: 'succeeded',
      deliverables: [{
        artifactId: 'artifact-1',
        title: 'report.pdf',
        kind: 'pdf',
        availability: 'available',
        location: 'artifact_store',
        capabilities: ['preview', 'download'],
        uri: 'media://artifact-1',
      }],
      evidence: [],
      createdAt: '2026-09-01T00:00:00.000Z',
    };

    const view = buildAssistantTurnViewModel({
      message,
      isStreaming: false,
      reasoningLevel: 'stream',
    });

    expect(view.outcome?.deliverables).toHaveLength(1);
    expect(view.attachments).toEqual([]);
  });

  it('keeps every structured product reference for the result tail', () => {
    const delivery = {
      version: 2,
      operation: 'completed',
      primary: {
        kind: 'workflow_run',
        id: 'run-1',
        title: 'Publish report',
        capabilities: ['open'],
      },
    };
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([{
        type: 'tool_use',
        id: 'workflow-1',
        name: 'workflow',
        status: 'done',
        details: { delivery },
      }]),
      isStreaming: false,
      reasoningLevel: 'stream',
    });

    expect(view.deliveries).toEqual([{ key: 'workflow-1', delivery }]);
  });
});
