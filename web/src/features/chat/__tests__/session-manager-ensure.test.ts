// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '@/lib/fetch';
import { apiFetchWithStartupRetry } from '@/lib/gateway-startup-retry';
import {
  parseWebchatSessionKeyForCreate,
  SessionManager,
} from '@/features/chat/session/session-manager';

vi.mock('@/lib/fetch', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('@/lib/gateway-startup-retry', () => ({
  apiFetchWithStartupRetry: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);
const mockedApiFetchWithStartupRetry = vi.mocked(apiFetchWithStartupRetry);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseWebchatSessionKeyForCreate', () => {
  it('extracts agent and chat id from a canonical webchat key', () => {
    expect(
      parseWebchatSessionKeyForCreate('agent:coder:webchat:default:direct:chat_1782872704761'),
    ).toEqual({
      agentId: 'coder',
      channel: 'webchat',
      chatId: 'chat_1782872704761',
    });
  });

  it('rejects non-webchat or malformed keys', () => {
    expect(parseWebchatSessionKeyForCreate('agent:coder:telegram:default:direct:1')).toBeNull();
    expect(parseWebchatSessionKeyForCreate('agent:coder:webchat:default')).toBeNull();
  });
});

describe('SessionManager.forkSessionAtTurn', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('posts the stable turn id and returns the server-generated key', async () => {
    const sourceKey = 'agent:main:webchat:default:direct:source';
    const targetKey = 'agent:main:webchat:default:direct:generated';
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({
      ok: true,
      sessionKey: targetKey,
      rowCount: 2,
      lastTurnId: 'turn-1',
      session: { key: targetKey, messages: [] },
    }, 201));

    const result = await new SessionManager().forkSessionAtTurn(sourceKey, 'turn-1');

    expect(result.sessionKey).toBe(targetKey);
    expect(mockedApiFetch).toHaveBeenCalledOnce();
    expect(mockedApiFetch.mock.calls[0]?.[0]).toContain(
      `/api/sessions/${encodeURIComponent(sourceKey)}/fork-at-turn`,
    );
    expect(JSON.parse(String(mockedApiFetch.mock.calls[0]?.[1]?.body)))
      .toEqual({ lastTurnId: 'turn-1' });
  });
});

describe('SessionManager.ensureSessionExists', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('does not create when the session already resolves', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({ ok: true, payload: {} }));

    await new SessionManager().ensureSessionExists('agent:coder:webchat:default:direct:chat_a');

    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
  });

  it('creates the same webchat session after a 404 resolve miss', async () => {
    mockedApiFetch
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: 'Session not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ session: { key: 'agent:coder:webchat:default:direct:chat_a' } }, 201));

    await new SessionManager().ensureSessionExists('agent:coder:webchat:default:direct:chat_a');

    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
    const createInit = mockedApiFetch.mock.calls[1]?.[1];
    expect(JSON.parse(String(createInit?.body))).toEqual({
      channel: 'webchat',
      agentId: 'coder',
      chat_id: 'chat_a',
    });
  });

  it('does not create when resolve fails for auth or other non-404 errors', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({ error: 'Invalid authentication token' }, 401));

    await expect(
      new SessionManager().ensureSessionExists('agent:coder:webchat:default:direct:chat_a'),
    ).rejects.toThrow('Invalid authentication token');

    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('SessionManager.createSession environment', () => {
  beforeEach(() => mockedApiFetch.mockReset());
  it('sends the explicit mode together with initial model and project', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({ session: { key: 'created' } }, 201));
    await new SessionManager().createSession({ projectId: 'project-a', executionMode: 'managed_worktree', initialAgentConfig: { model: 'test/model' } });
    expect(JSON.parse(String(mockedApiFetch.mock.calls[0]?.[1]?.body))).toEqual({
      channel: 'webchat', projectId: 'project-a', executionMode: 'managed_worktree', initialAgentConfig: { model: 'test/model' },
    });
  });
  it('surfaces the server reason instead of silently retrying in Local', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({ error: 'Repository has uncommitted changes' }, 409));
    await expect(new SessionManager().createSession({ projectId: 'project-a', executionMode: 'managed_worktree' })).rejects.toThrow('uncommitted changes');
    expect(mockedApiFetch).toHaveBeenCalledOnce();
  });
});

describe('SessionManager.loadSession', () => {
  beforeEach(() => {
    mockedApiFetchWithStartupRetry.mockReset();
  });

  it('extends the initial raw history page when the visible tail starts with an assistant fragment', async () => {
    mockedApiFetchWithStartupRetry
      .mockResolvedValueOnce(
        jsonResponse({
          session: {
            key: 'agent:main:webchat:default:direct:chat_long',
            name: 'Long turn',
            messages: [
              {
                role: 'toolResult',
                content: [{ type: 'text', text: 'tool output' }],
                timestamp: '2026-07-05T09:17:13.878Z',
                tool_call_id: 'call_1',
              },
              {
                role: 'assistant',
                content: [{ type: 'text', text: 'final answer' }],
                timestamp: '2026-07-05T09:17:41.870Z',
              },
            ],
          },
          pagination: {
            total: 138,
            limit: 50,
            offset: 0,
            hasMore: true,
            nextBeforeCursor: '136',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          session: {
            key: 'agent:main:webchat:default:direct:chat_long',
            name: 'Long turn',
            messages: [
              {
                role: 'user',
                content: 'please do the long task',
                timestamp: '2026-07-05T09:10:00.000Z',
              },
              {
                role: 'assistant',
                content: [
                  {
                    type: 'toolCall',
                    id: 'call_1',
                    name: 'exec_command',
                    arguments: { cmd: 'pnpm test' },
                  },
                ],
                timestamp: '2026-07-05T09:10:01.000Z',
              },
            ],
          },
          pagination: { total: 138, limit: 50, offset: 0, hasMore: false },
        }),
      );

    const result = await new SessionManager().loadSession(
      'agent:main:webchat:default:direct:chat_long',
    );

    expect(mockedApiFetchWithStartupRetry).toHaveBeenCalledTimes(2);
    expect(result.name).toBe('Long turn');
    expect(result.hasMore).toBe(false);
    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(result.messages[0]?.content).toEqual([
      { type: 'text', text: 'please do the long task' },
    ]);
  });

  it('rejects history responses without the current pagination contract', async () => {
    mockedApiFetchWithStartupRetry.mockResolvedValueOnce(
      jsonResponse({
        session: {
          key: 'agent:main:webchat:default:direct:chat_invalid',
          messages: [],
        },
      }),
    );

    await expect(
      new SessionManager().loadSession('agent:main:webchat:default:direct:chat_invalid'),
    ).rejects.toThrow();
  });
});

describe('SessionManager.loadTimeline', () => {
  beforeEach(() => {
    mockedApiFetchWithStartupRetry.mockReset();
  });

  it('rejects timeline responses that do not match the current contract', async () => {
    mockedApiFetchWithStartupRetry.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(
      new SessionManager().loadTimeline('agent:main:webchat:default:direct:chat_invalid'),
    ).rejects.toThrow('Invalid session timeline response');
  });
});
