// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '@/lib/fetch';
import { apiFetchWithStartupRetry } from '@/lib/gateway-startup-retry';
import {
  SessionManager,
} from '@/features/chat/session/session-manager';

vi.mock('@/lib/fetch', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('@/lib/gateway-startup-retry', () => ({
  apiFetchWithStartupRetry: vi.fn(),
}));
const drafts = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('@/features/chat/session/local-session-drafts', () => ({
  readLocalSessionDraft: drafts.read, saveLocalSessionDraft: drafts.save,
  rememberSessionTranscript: vi.fn(), draftAgentConfig: vi.fn(),
  readPendingSessionCommand: vi.fn(async () => undefined), confirmSessionCommand: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);
const mockedApiFetchWithStartupRetry = vi.mocked(apiFetchWithStartupRetry);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SessionManager.forkSessionAtTurn', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('posts the stable turn id and returns the server-generated key', async () => {
    const sourceKey = '0d55d9c9-189f-5702-8a5f-815d346e8b17';
    const targetKey = '80894040-67ed-5752-96d4-d973d59dcc7d';
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({
      ok: true,
      conversationId: targetKey,
      rowCount: 2,
      lastTurnId: 'turn-1',
      session: { key: targetKey, messages: [] },
    }, 201));

    const result = await new SessionManager().forkSessionAtTurn(sourceKey, 'turn-1');

    expect(result.conversationId).toBe(targetKey);
    expect(mockedApiFetch).toHaveBeenCalledOnce();
    expect(mockedApiFetch.mock.calls[0]?.[0]).toContain(
      `/api/sessions/${encodeURIComponent(sourceKey)}/fork-at-turn`,
    );
    expect(JSON.parse(String(mockedApiFetch.mock.calls[0]?.[1]?.body)))
      .toEqual({ lastTurnId: 'turn-1' });
  });
});

describe('SessionManager local drafts', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('persists a final UUID without requesting the Gateway', async () => {
    const session = await new SessionManager().createSession({ agentId: 'main' });
    expect(session.key).toMatch(/^[a-f0-9-]{36}$/);
    expect(drafts.save).toHaveBeenCalledWith(expect.objectContaining({ conversationId: session.key }));
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});

describe('SessionManager.createSession environment', () => {
  beforeEach(() => mockedApiFetch.mockReset());
  it('persists the explicit mode together with initial model and project', async () => {
    await new SessionManager().createSession({ projectId: 'project-a', executionMode: 'managed_worktree', initialAgentConfig: { model: 'test/model' } });
    expect(drafts.save).toHaveBeenLastCalledWith(expect.objectContaining({ creation: expect.objectContaining({
      projectId: 'project-a', execution: { mode: 'managed_worktree' }, model: 'test/model',
    }) }));
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
  it('does not open a draft if persistence fails', async () => {
    drafts.save.mockRejectedValueOnce(new Error('Disk full'));
    await expect(new SessionManager().createSession()).rejects.toThrow('Disk full');
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});

describe('SessionManager.resetSession', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('resets the existing conversation without creating another project session', async () => {
    const conversationId = '134874b6-5536-51bc-8c22-57982488c47a';
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({
      ok: true,
      reset: true,
      transcriptId: '98936ed0-fbe7-5ca2-8add-03aa88dfbc35',
    }));

    await new SessionManager().resetSession(conversationId);

    expect(mockedApiFetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/sessions/${encodeURIComponent(conversationId)}/reset`),
      { method: 'POST' },
    );
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
            key: '870ee827-28b5-5dd2-8884-4d6b153c5f3c',
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
            key: '870ee827-28b5-5dd2-8884-4d6b153c5f3c',
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
      '870ee827-28b5-5dd2-8884-4d6b153c5f3c',
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
          key: '88f62be8-0a58-546b-a62c-4146c54d81fd',
          messages: [],
        },
      }),
    );

    await expect(
      new SessionManager().loadSession('88f62be8-0a58-546b-a62c-4146c54d81fd'),
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
      new SessionManager().loadTimeline('88f62be8-0a58-546b-a62c-4146c54d81fd'),
    ).rejects.toThrow('Invalid session timeline response');
  });
});
