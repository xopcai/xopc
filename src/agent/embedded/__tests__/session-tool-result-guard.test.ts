import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';

import { guardSessionManager } from '../session-tool-result-guard.js';
import { repairAssistantUsageInSessionManager } from '../session-manager-init.js';
import { onSessionTranscriptUpdate } from '../../../session/transcript-events.js';
import { transcriptRowsToClientHistory } from '../../../session/client-history.js';

describe('session-tool-result-guard', () => {
  it('retains compact search provenance when large results exceed the persisted details limit', () => {
    const listener = vi.fn();
    const unsubscribe = onSessionTranscriptUpdate(listener);
    try {
      const sm = guardSessionManager(SessionManager.inMemory(process.cwd()), { conversationId: 'search-history-test' });
      const searchInfo = { provider: 'xopc-cloud', upstream: 'tavily', cached: true, capturedAt: 123, attemptCount: 2, attempts: [
        { provider: 'xopc-cloud', upstream: 'deepseek', outcome: 'error', reason: 'timeout' },
        { provider: 'xopc-cloud', upstream: 'tavily', outcome: 'success' },
      ] };
      sm.appendMessage({ role: 'toolResult', toolCallId: 'search-1', toolName: 'web_search',
        content: [{ type: 'text', text: 'Search results' }], timestamp: Date.now(), details: {
          provider: 'xopc-cloud', results: [{ description: 'x'.repeat(40_000) }], searchInfo,
        },
      } as never);
      const persisted = listener.mock.calls.at(-1)?.[0]?.message;
      expect(persisted?.details).toMatchObject({ persistedDetailsTruncated: true, searchInfo });
      expect(Buffer.byteLength(JSON.stringify(persisted?.details))).toBeLessThanOrEqual(8192);
      expect(persisted?.details.results).toBeUndefined();
      const history = transcriptRowsToClientHistory([
        { role: 'assistant', content: [{ type: 'toolCall', id: 'search-1', name: 'web_search', arguments: { query: 'query' } }], timestamp: 1 },
        persisted,
      ] as never);
      expect(history[0]?.toolCalls?.[0]?.details).toMatchObject({ searchInfo });
    } finally { unsubscribe(); }
  });

  it('appendMessage emits transcript update for SQLite-backed session key', () => {
    const listener = vi.fn();
    const unsubscribe = onSessionTranscriptUpdate(listener);

    const sm = guardSessionManager(SessionManager.inMemory(process.cwd()), {
      conversationId: 'agent:main:test',
    });
    sm.setActiveTurnId?.('turn-123');
    sm.appendMessage({
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    } as never);
    sm.appendMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: 'hi there' },
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'image_generate',
          arguments: { prompt: 'cat' },
        },
      ],
      timestamp: Date.now(),
    } as never);
    sm.appendMessage({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'image_generate',
      content: [{ type: 'text', text: 'Saved: /tmp/cat.png' }],
      timestamp: Date.now(),
    } as never);

    expect(listener).toHaveBeenCalled();
    const updates = listener.mock.calls.map(([update]) => update);
    expect(updates.some((update) => (update?.message as { role?: string })?.role === 'user')).toBe(true);
    expect(updates.some((update) => (update?.message as { role?: string })?.role === 'assistant')).toBe(true);
    expect(updates.some((update) => (update?.message as { role?: string })?.role === 'toolResult')).toBe(true);
    expect(updates.every((update) => (update?.message as { turnId?: string })?.turnId === 'turn-123')).toBe(true);
    unsubscribe();
  });

  it('repairAssistantUsageInSessionManager fills missing usage on assistant rows', () => {
    const sm = SessionManager.inMemory(process.cwd());
    sm.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'legacy' }],
      timestamp: Date.now(),
      stopReason: 'stop',
    } as never);
    repairAssistantUsageInSessionManager(sm);
    const ctx = sm.buildSessionContext();
    const assistant = ctx.messages.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect((assistant as { usage?: { totalTokens?: number } }).usage?.totalTokens).toBe(0);
  });

  it('keeps structured media when oversized tool details are sanitized', () => {
    const listener = vi.fn();
    const unsubscribe = onSessionTranscriptUpdate(listener);
    const sm = guardSessionManager(SessionManager.inMemory(process.cwd()), {
      conversationId: 'agent:main:media-test',
    });

    sm.appendMessage({
      role: 'toolResult',
      toolCallId: 'call-media',
      toolName: 'send_media',
      content: [{ type: 'text', text: 'Media attached' }],
      details: {
        media: [{
          id: 'cat---id.webp',
          bucket: 'outbound',
          type: 'photo',
          mimeType: 'image/webp',
          name: 'cat.webp',
          size: 120,
          uri: 'media://outbound/cat---id.webp',
          path: '/state/media/outbound/cat---id.webp',
        }],
        oversized: 'x'.repeat(80_000),
      },
      timestamp: Date.now(),
    } as never);

    const update = listener.mock.calls.at(-1)?.[0];
    expect(update?.message).toMatchObject({
      role: 'toolResult',
      details: {
        persistedDetailsTruncated: true,
        media: [{ uri: 'media://outbound/cat---id.webp' }],
      },
    });
    unsubscribe();
  });
});
