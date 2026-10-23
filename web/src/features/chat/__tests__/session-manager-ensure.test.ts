// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmSessionCommand, type LocalSessionDraft } from '@/features/chat/session/local-session-drafts';

import { apiFetch } from '@/lib/fetch';
import { apiFetchWithStartupRetry } from '@/lib/gateway-startup-retry';
import type { Message } from '@/features/chat/messages/messages.types';
import {
  SessionManager, SessionModelRequiredError,
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

describe('SessionManager agent config', () => {
  const payload = {
    model: 'xopc-cloud/auto', thinkingLevel: 'low', configVersion: 7, fixedModel: true,
    activityDetail: { default: 'on', override: 'stream', effective: 'stream', source: 'session' },
    verboseLevel: 'full', effectiveWorkspacePath: '/tmp/workspace',
    workingDirectoryLocked: false, userContextMode: 'enabled', workspaceSource: 'agent_workspace',
  };

  beforeEach(() => {
    mockedApiFetch.mockReset();
    drafts.read.mockResolvedValue(undefined);
  });

  it('loads the current Gateway config without the removed reasoningLevel field', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({ ok: true, payload }));
    const config = await new SessionManager().loadSessionAgentConfig('config-session');
    expect(config).toMatchObject({ model: payload.model, activityDetail: payload.activityDetail });
  });

  it.each(['session', 'task'])('parses the config returned when changing a %s model', async (kind) => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({ ok: true, payload }));
    const manager = new SessionManager();
    const config = kind === 'session'
      ? await manager.patchSessionAgentConfig('config-session', { model: payload.model })
      : await manager.patchTaskConversationModel('task', payload.model);
    expect(config).toMatchObject({ model: payload.model, activityDetail: payload.activityDetail });
  });

  it('rejects malformed activity detail instead of silently defaulting it', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({
      ok: true, payload: { ...payload, activityDetail: { ...payload.activityDetail, effective: 'invalid' } },
    }));
    await expect(new SessionManager().loadSessionAgentConfig('invalid-config-session'))
      .rejects.toThrow('Invalid session agent config response');
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

  it('starts a fresh request after local completion and keeps the newer request deduplicated', async () => {
    const key = 'f674f219-ec7c-4f1d-ae4e-955a20b6a8ab';
    const before: Message[] = [{ role: 'user', content: [], timestamp: 1 }];
    const after: Message[] = [...before, { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 2 }];
    const resolvers: Array<(response: Response) => void> = [];
    mockedApiFetchWithStartupRetry.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
    const manager = new SessionManager();
    const oldLoad = manager.loadSession(key, 0, undefined, undefined, before);
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    const newLoad = manager.loadSession(key, 0, undefined, undefined, after);
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[0](jsonResponse({ session: { key, messages: before }, pagination: { total: 1, limit: 50, offset: 0, hasMore: false } }));
    await oldLoad;
    const sameNewLoad = manager.loadSession(key, 0, undefined, undefined, after);
    await vi.waitFor(() => expect(drafts.read).toHaveBeenCalled());
    resolvers[1](jsonResponse({ session: { key, messages: after }, pagination: { total: 2, limit: 50, offset: 0, hasMore: false } }));
    const [fresh, shared] = await Promise.all([newLoad, sameNewLoad]);
    expect(fresh).toBe(shared);
    expect(fresh.messages).toHaveLength(2);
    expect(mockedApiFetchWithStartupRetry).toHaveBeenCalledTimes(2);
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
    drafts.read.mockReset();
  });

  it('keeps a local draft timeline empty until the session is persisted', async () => {
    const conversationId = '2b2f86c0-3819-4874-9d79-e75bbff18f71';
    drafts.read.mockResolvedValue({ conversationId });

    expect(await new SessionManager().loadTimeline(conversationId)).toEqual([]);
    expect(mockedApiFetchWithStartupRetry).not.toHaveBeenCalled();

    drafts.read.mockResolvedValue(undefined);
    mockedApiFetchWithStartupRetry.mockResolvedValueOnce(jsonResponse({ ok: true, items: [] }));
    expect(await new SessionManager().loadTimeline(conversationId)).toEqual([]);
    expect(mockedApiFetchWithStartupRetry).toHaveBeenCalledWith(
      expect.stringContaining(`/api/sessions/${conversationId}/timeline`),
    );
  });

  it('rejects timeline responses that do not match the current contract', async () => {
    mockedApiFetchWithStartupRetry.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(
      new SessionManager().loadTimeline('88f62be8-0a58-546b-a62c-4146c54d81fd'),
    ).rejects.toThrow('Invalid session timeline response');
  });
});

describe('SessionManager materialization confirmation', () => {
  let draft: LocalSessionDraft | undefined;
  const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  beforeEach(() => {
    mockedApiFetch.mockReset();
    vi.mocked(confirmSessionCommand).mockReset();
    draft = { conversationId, createdAt: new Date().toISOString(), creation: {
      agentId: 'main', model: 'test/model', thinkingLevel: 'off', temporary: false, projectId: null, execution: null,
    } };
    drafts.read.mockImplementation(async () => draft);
    drafts.save.mockImplementation(async value => { draft = value; });
    vi.mocked(confirmSessionCommand).mockImplementation(async () => { draft = undefined; });
  });
  afterEach(() => {
    drafts.read.mockReset();
    drafts.save.mockReset();
    vi.mocked(confirmSessionCommand).mockReset();
    vi.restoreAllMocks();
  });

  it('shares creation between concurrent file and terminal consumers with separate draft snapshots', async () => {
    const files = new SessionManager();
    const terminal = new SessionManager();
    vi.spyOn(files, 'loadSessionAgentConfig').mockResolvedValue({} as never);
    vi.spyOn(terminal, 'loadSessionAgentConfig').mockResolvedValue({} as never);
    drafts.read.mockImplementation(async () => draft ? structuredClone(draft) : undefined);
    let respond!: (response: Response) => void;
    mockedApiFetch.mockImplementation(() => new Promise(resolve => { respond = resolve; }));
    drafts.save.mockClear();
    const first = files.materialize(conversationId, 'session_resources');
    const second = terminal.materialize(conversationId, 'session_resources');
    expect(second).toBe(first);
    await vi.waitFor(() => expect(mockedApiFetch).toHaveBeenCalledOnce());
    const commandId = draft!.materialization!.commandId;
    respond(jsonResponse({ payload: { receipt: { conversationId, clientMessageId: commandId, transcriptId: 'transcript', lifecycle: 'ready' } } }, 202));
    await Promise.all([first, second]);
    expect(drafts.save).toHaveBeenCalledOnce();
    expect(confirmSessionCommand).toHaveBeenCalledOnce();
    expect(draft).toBeUndefined();
  });

  it('keeps an unconfigured draft editable so model selection can recover terminal creation', async () => {
    const manager = new SessionManager();
    vi.spyOn(manager, 'loadSessionAgentConfig').mockResolvedValue({} as never);
    draft!.creation.model = '';
    drafts.save.mockClear();
    await expect(manager.materialize(conversationId, 'session_resources')).rejects.toBeInstanceOf(SessionModelRequiredError);
    expect(draft!.materialization).toBeUndefined();
    expect(drafts.save).not.toHaveBeenCalled();
    expect(mockedApiFetch).not.toHaveBeenCalled();

    await manager.patchSessionAgentConfig(conversationId, { model: 'test/model' });
    mockedApiFetch.mockImplementation(async (_url, init) => {
      const command = JSON.parse(String(init?.body));
      return jsonResponse({ payload: { receipt: { conversationId, clientMessageId: command.commandId, transcriptId: 'transcript', lifecycle: 'ready' } } }, 202);
    });
    await manager.materialize(conversationId, 'session_resources');
    expect(confirmSessionCommand).toHaveBeenCalledWith(conversationId, 'transcript');
    expect(draft).toBeUndefined();
  });

  it.each(['preparing', 'preparation_failed'])('confirms persisted creation even while resources are %s', async lifecycle => {
    const manager = new SessionManager();
    vi.spyOn(manager, 'loadSessionAgentConfig').mockResolvedValue({} as never);
    mockedApiFetch.mockImplementation(async (_url, init) => {
      const command = JSON.parse(String(init?.body));
      return jsonResponse({ payload: { receipt: { conversationId, clientMessageId: command.commandId, transcriptId: 'transcript', lifecycle } } }, 202);
    });
    await expect(manager.materialize(conversationId, 'session_resources')).rejects.toThrow('Conversation environment is not ready yet');
    expect(confirmSessionCommand).toHaveBeenCalledWith(conversationId, 'transcript');
    expect(draft).toBeUndefined();
  });

  it('does not clear a subsequent pending input when a materialization response arrives late', async () => {
    const manager = new SessionManager();
    vi.spyOn(manager, 'loadSessionAgentConfig').mockResolvedValue({} as never);
    let respond!: (response: Response) => void;
    mockedApiFetch.mockImplementation(() => new Promise(resolve => { respond = resolve; }));
    const pending = manager.materialize(conversationId, 'session_resources');
    await vi.waitFor(() => expect(mockedApiFetch).toHaveBeenCalledOnce());
    const commandId = draft!.materialization!.commandId;
    draft = undefined;
    respond(jsonResponse({ payload: { receipt: { conversationId, clientMessageId: commandId, transcriptId: 'transcript', lifecycle: 'ready' } } }, 202));
    await pending;
    expect(confirmSessionCommand).not.toHaveBeenCalled();
  });
});
