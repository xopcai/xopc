import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages, mergeConsecutiveAssistantMessages } from '@/features/chat/messages/agent-messages';
import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { selectDisplayMessages } from '@/features/chat/session/chat-session-view';

const outcome = { version: 1, outcomeId: 'worker-outcome', runId: 'worker', turnId: 'worker',
  status: 'succeeded', deliverables: [{ artifactId: 'image', title: 'Sunset.png', kind: 'image',
    availability: 'available', location: 'artifact_store', uri: 'media://outbound/sunset.png',
    mimeType: 'image/png', capabilities: ['preview', 'download'] }], evidence: [], createdAt: '2026-10-08T00:00:00Z' };
const delivery = { version: 1, deliveryId: 'delivery', taskId: 'task', taskRunId: 'worker',
  taskTitle: 'Draw sunset', conversationId: 'main', originTranscriptId: 'transcript',
  assignmentEpoch: 1, outcome, createdAt: 1 };

describe('background results during a live main reply', () => {
  it('hydrates, deduplicates and displays the result without overwriting or merging the live reply', () => {
    const [result] = normalizeAgentMessages([{ role: 'assistant', turnId: 'task-result:delivery', startsNewBubble: true,
      content: 'Draw sunset: Results ready.', metadata: { taskResultDelivery: delivery, turnOutcome: outcome } }]);
    expect(result?.taskResultDelivery?.deliveryId).toBe('delivery');
    if (!result) throw new Error('Expected result');
    const stream = { role: 'assistant' as const, turnId: 'main-run', content: [{ type: 'text' as const, text: 'Continuing the reply' }] };
    useChatSessionStore.setState({ sessions: {} });
    const store = useChatSessionStore.getState();
    store.initSessionSnapshot('main', { ...defaultSessionMeta(), historyStatus: 'ready',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Another question' }] }],
      hasMore: false, streamingMsg: stream, streaming: true, sending: false, progress: null, taskPlan: null });
    store.setCommittedSnapshot('main', { messages: [result], hasMore: false });
    store.setCommittedSnapshot('main', { messages: [result], hasMore: false });
    const current = useChatSessionStore.getState().sessions.main;
    expect(current.messages).toHaveLength(2);
    expect(current.streamingMsg?.content).toEqual(stream.content);
    const displayed = selectDisplayMessages({ viewConversationId: 'main', conversationId: 'main',
      messages: current.messages, streamingMsg: current.streamingMsg });
    expect(displayed).toHaveLength(3);
    expect(displayed[1]?.outcome?.deliverables[0]?.artifactId).toBe('image');
    expect(displayed[2]?.content).toEqual(stream.content);
    expect(mergeConsecutiveAssistantMessages([stream, result, stream])).toHaveLength(3);
    store.finalizeStreamingTurn('main', stream);
    expect(useChatSessionStore.getState().sessions.main?.messages).toHaveLength(3);
  });
});
