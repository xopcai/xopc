import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';
import { buildAssistantTurnViewModel } from '@/features/chat/messages/assistant-turn-view-model';

describe('turn outcome messages', () => {
  it('merges the persisted outcome state row into the preceding assistant turn', () => {
    const messages = normalizeAgentMessages([
      {
        role: 'assistant',
        turnId: 'run-1',
        content: 'Implemented the change.',
        timestamp: 1,
      },
      {
        role: 'assistant',
        turnId: 'run-1',
        content: '',
        metadata: {
          turnOutcome: {
            version: 1,
            outcomeId: 'run-1:outcome',
            runId: 'run-1',
            turnId: 'run-1',
            status: 'succeeded',
            deliverables: [],
            changeSet: {
              changeSetId: 'run-1:changes',
              files: [{ path: 'src/store.ts', status: 'modified' }],
              added: 5,
              removed: 2,
              diff: 'diff',
              environment: 'workspace',
            },
            evidence: [],
            createdAt: '2026-09-01T00:00:00.000Z',
          },
        },
        timestamp: 2,
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.outcome?.changeSet?.files).toEqual([
      { path: 'src/store.ts', status: 'modified' },
    ]);
    expect(buildAssistantTurnViewModel({
      message: messages[0],
      isStreaming: false,
      reasoningLevel: 'stream',
    }).outcome?.outcomeId).toBe('run-1:outcome');
  });
});
