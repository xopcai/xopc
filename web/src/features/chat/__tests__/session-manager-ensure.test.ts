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

describe('SessionManager.loadSession', () => {
  beforeEach(() => {
    mockedApiFetchWithStartupRetry.mockReset();
  });

  it('extends the initial raw history page when the visible tail starts with an assistant fragment', async () => {
    mockedApiFetchWithStartupRetry
      .mockResolvedValueOnce(
        jsonResponse({
          session: {
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
          pagination: { hasMore: true, nextBeforeCursor: '136' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          session: {
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
          pagination: { hasMore: false },
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
});
