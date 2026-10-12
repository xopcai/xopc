import { describe, expect, it, vi } from 'vitest';

import { createSessionRecallTool } from '../session-recall-tool.js';

function textOf(result: any): string {
  return String(result.content?.[0]?.text ?? '');
}

describe('session_recall', () => {
  it('bounds escaped Personal output and paginates from delivered chronological rows without gaps', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ entryId: `entry-${index + 1}`,
      seq: index + 1, role: 'user', createdAt: Date.now(), content: `ORBIT ${'"\\\n'.repeat(10000)}` }));
    const recallSession = vi.fn((_key, _query, options) => rows.filter(row => row.seq < (options.beforeSeq ?? Infinity))
      .toSorted((a, b) => b.seq - a.seq).slice(0, options.limit));
    const tool = createSessionRecallTool({ getSessionStore: () => ({ recallSession } as any),
      getCurrentConversationId: () => 'current', maxOutputChars: 8000 });
    const seqs: number[] = [];
    let beforeSeq: number | undefined;
    for (let page = 0; page < 6; page++) {
      const result = await tool.execute(`page-${page}`, { query: 'ORBIT', limit: 20, maxCharsPerResult: 20000, beforeSeq });
      expect(textOf(result).length).toBeLessThanOrEqual(8000);
      const payload = JSON.parse(textOf(result));
      expect(payload).toMatchObject({ excerpts: true, truncated: true });
      expect(payload.results[0].content).toContain('ORBIT');
      seqs.push(...payload.results.map((row: { seq: number }) => row.seq));
      beforeSeq = payload.nextBeforeSeq;
      if (!beforeSeq) break;
    }
    expect(seqs).toEqual([6, 5, 4, 3, 2, 1]);
    expect(recallSession.mock.calls[0][2]).toMatchObject({ orderBySeq: true });
  });

  it('is scoped to the current session and returns raw transcript coordinates', async () => {
    const recallSession = vi.fn().mockReturnValue([{
      entryId: 'entry-7',
      seq: 7,
      role: 'user',
      createdAt: Date.parse('2026-08-27T00:00:00.000Z'),
      content: 'The exact launch code is ORBIT-7429.',
    }]);
    const tool = createSessionRecallTool({
      getSessionStore: () => ({ recallSession } as any),
      getCurrentConversationId: () => 'agent:main:webchat:default:dm:user',
    });

    const result = await tool.execute('call-1', { query: 'ORBIT-7429', limit: 4 });

    expect(recallSession).toHaveBeenCalledWith(
      'agent:main:webchat:default:dm:user',
      'ORBIT-7429',
      { limit: 4 },
    );
    expect(JSON.parse(textOf(result))).toMatchObject({
      success: true,
      count: 1,
      results: [{ seq: 7, entryId: 'entry-7', content: 'The exact launch code is ORBIT-7429.' }],
    });
  });

  it('cannot accept an arbitrary session key and fails without active context', async () => {
    const recallSession = vi.fn();
    const tool = createSessionRecallTool({
      getSessionStore: () => ({ recallSession } as any),
      getCurrentConversationId: () => undefined,
    });

    const result = await tool.execute('call-2', { query: 'secret', conversationId: 'other-session' } as any);

    expect(textOf(result)).toContain('unavailable outside an active session');
    expect(recallSession).not.toHaveBeenCalled();
  });
});
