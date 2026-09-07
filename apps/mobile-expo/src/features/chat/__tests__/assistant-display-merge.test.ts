import { describe, expect, it } from 'vitest';

import { mergeStreamingAssistantIntoMessages, parseSessionMessages } from '../session-message-parser';
import type { Message } from '../messages.types';

describe('mergeStreamingAssistantIntoMessages', () => {
  it('keeps persisted and live segments from one assistant turn in one stable row', () => {
    const persisted: Message = {
      id: 'persisted-narration',
      role: 'assistant',
      content: [
        { type: 'text', text: 'I found the project.', segmentId: 'segment-1', presentation: 'narration' },
        { type: 'tool_use', id: 'tool-1', name: 'web_search', status: 'done' },
      ],
      timestamp: 100,
    };
    const streaming: Message = {
      id: 'stream-200',
      role: 'assistant',
      content: [
        { type: 'text', text: 'I found the project.', segmentId: 'segment-1', presentation: 'narration' },
        { type: 'tool_use', id: 'tool-1', name: 'web_search', status: 'done' },
        { type: 'text', text: 'The materials are now clear.', segmentId: 'segment-2', presentation: 'answer' },
      ],
      timestamp: 200,
    };

    const merged = mergeStreamingAssistantIntoMessages([persisted], streaming);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('stream-200');
    expect(merged[0]?.content).toEqual(streaming.content);
  });

  it('does not duplicate committed text when history lacks streaming segment ids', () => {
    const persisted = parseSessionMessages([
      { id: 'stored', role: 'assistant', content: 'First sentence. Second sentence.' },
    ]);
    const streaming: Message = {
      id: 'live', role: 'assistant', content: [
        { type: 'text', text: 'First sentence. Second sentence.', segmentId: 'segment', presentation: 'answer' },
      ],
    };
    expect(mergeStreamingAssistantIntoMessages(persisted, streaming)[0].content).toEqual(streaming.content);
  });

  it('keeps the longer text when history gets ahead of the throttled live render', () => {
    const persisted = parseSessionMessages([
      { id: 'stored', role: 'assistant', content: 'First sentence. Second sentence.' },
    ]);
    const streaming: Message = {
      id: 'live', role: 'assistant', content: [
        { type: 'text', text: 'First sentence.', segmentId: 'segment', presentation: 'pending' },
      ],
    };
    expect(mergeStreamingAssistantIntoMessages(persisted, streaming)[0].content).toEqual([
      { type: 'text', text: 'First sentence. Second sentence.', segmentId: 'segment', presentation: 'answer' },
    ]);
  });

  it('does not cross a user-message turn boundary', () => {
    const previousAssistant: Message = {
      id: 'assistant-1',
      role: 'assistant',
      content: [{ type: 'text', text: 'Previous answer.' }],
    };
    const user: Message = {
      id: 'user-2',
      role: 'user',
      content: [{ type: 'text', text: 'Next question.' }],
    };
    const streaming: Message = {
      id: 'stream-3',
      role: 'assistant',
      content: [{ type: 'text', text: 'Next answer.' }],
    };

    expect(mergeStreamingAssistantIntoMessages([previousAssistant, user], streaming)).toEqual([
      previousAssistant,
      user,
      streaming,
    ]);
  });

  it('keeps the canonical outcome while live content catches up', () => {
    const persisted: Message = {
      role: 'assistant',
      turnId: 'turn-1',
      content: [{ type: 'text', text: 'Done.' }],
      outcome: {
        version: 1,
        outcomeId: 'outcome-1',
        runId: 'run-1',
        turnId: 'turn-1',
        status: 'succeeded',
        deliverables: [],
        evidence: [],
        createdAt: '2026-09-03T00:00:00.000Z',
      },
    };
    const streaming: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Done.' }],
    };

    const [merged] = mergeStreamingAssistantIntoMessages([persisted], streaming);

    expect(merged.turnId).toBe('turn-1');
    expect(merged.outcome?.outcomeId).toBe('outcome-1');
  });
});
