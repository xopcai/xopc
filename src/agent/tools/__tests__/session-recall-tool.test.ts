import { describe, expect, it, vi } from 'vitest';

import { createSessionRecallTool } from '../session-recall-tool.js';

function textOf(result: any): string {
  return String(result.content?.[0]?.text ?? '');
}

describe('session_recall', () => {
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
      getCurrentSessionKey: () => 'agent:main:webchat:default:dm:user',
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
      getCurrentSessionKey: () => undefined,
    });

    const result = await tool.execute('call-2', { query: 'secret', sessionKey: 'other-session' } as any);

    expect(textOf(result)).toContain('unavailable outside an active session');
    expect(recallSession).not.toHaveBeenCalled();
  });
});
