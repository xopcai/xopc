import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { queryKeys } from '../keys';
import { fetchSessionAgentConfig, resolveEffectiveModelId, sessionModelMutationOptions, setSessionModelRef } from '../models';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  formatApiHttpError: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

describe('fetchSessionAgentConfig', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('uses the same effective activity-detail setting as WebUI', async () => {
    mockedApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        payload: {
          model: 'openai/gpt-test',
          reasoningLevel: 'on',
          activityDetail: { default: 'on', override: 'off', effective: 'off' },
        },
      }),
    } as Response);

    await expect(fetchSessionAgentConfig('chat-1')).resolves.toMatchObject({
      model: 'openai/gpt-test',
      reasoningLevel: 'off',
    });
  });
});

describe('setSessionModelRef', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('updates a task-bound conversation through the task endpoint', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await expect(setSessionModelRef('session-1', 'openai/gpt-test', 'task/1')).resolves.toBe(true);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/tasks/task%2F1/conversation/config', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ model: 'openai/gpt-test' }),
    }));
  });

  it('preserves structured gateway errors for the user-facing failure message', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'Model unavailable' },
    }), { status: 400 }));

    await expect(setSessionModelRef('session-1', 'missing/model')).rejects.toThrow('Model unavailable');
  });
});

describe('session model mutation', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  const initialConfig = {
    model: 'provider/old',
    thinkingLevel: 'high',
    reasoningLevel: 'on',
    effectiveWorkspacePath: '/workspace',
    workingDirectoryLocked: true,
  };

  it('refreshes the displayed model and the gateway-adjusted thinking level after saving', async () => {
    const client = new QueryClient();
    const queryKey = queryKeys.sessionAgentConfig('session-1');
    client.setQueryData(queryKey, initialConfig);
    const updated = { ...initialConfig, model: 'provider/new', thinkingLevel: 'off' };
    mockedApiFetch.mockImplementation(async (_path, init) => new Response(JSON.stringify(
      init?.method === 'PATCH' ? { ok: true } : { payload: updated },
    )));
    const query = new QueryObserver(client, {
      queryKey,
      queryFn: () => fetchSessionAgentConfig('session-1'),
      staleTime: Infinity,
    });
    const unsubscribe = query.subscribe(() => {});
    const mutation = new MutationObserver(client, sessionModelMutationOptions(client, 'session-1'));

    await mutation.mutate('provider/new');

    expect(client.getQueryData(queryKey)).toEqual(updated);
    expect(resolveEffectiveModelId({ defaultId: 'provider/old', items: [
      { id: 'provider/old' }, { id: 'provider/new' },
    ] }, query.getCurrentResult().data?.model ?? null)).toBe('provider/new');
    unsubscribe();
    client.clear();
  });

  it('keeps the previous model when saving fails and propagates the error', async () => {
    const client = new QueryClient();
    const queryKey = queryKeys.sessionAgentConfig('session-1');
    client.setQueryData(queryKey, initialConfig);
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Model unavailable' }), { status: 400 }));
    const mutation = new MutationObserver(client, sessionModelMutationOptions(client, 'session-1'));

    await expect(mutation.mutate('provider/new')).rejects.toThrow('Model unavailable');

    expect(client.getQueryData(queryKey)).toEqual(initialConfig);
    client.clear();
  });

  it('serializes rapid selections so the last selection remains saved and displayed', async () => {
    const client = new QueryClient();
    const queryKey = queryKeys.sessionAgentConfig('session-1');
    client.setQueryData(queryKey, initialConfig);
    let finishFirst!: (response: Response) => void;
    mockedApiFetch.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const mutation = new MutationObserver(client, sessionModelMutationOptions(client, 'session-1'));

    const first = mutation.mutate('provider/second');
    const last = mutation.mutate('provider/last');
    await vi.waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(1));
    finishFirst(new Response(JSON.stringify({ ok: true })));
    await Promise.all([first, last]);

    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(queryKey)).toEqual({ ...initialConfig, model: 'provider/last' });
    client.clear();
  });

  it('discards a stale config read that finishes after saving the new model', async () => {
    const client = new QueryClient();
    const queryKey = queryKeys.sessionAgentConfig('session-1');
    client.setQueryData(queryKey, initialConfig);
    let finishRead!: (config: typeof initialConfig) => void;
    const staleRead = client.fetchQuery({
      queryKey,
      queryFn: () => new Promise<typeof initialConfig>((resolve) => { finishRead = resolve; }),
    }).catch(() => {});
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const mutation = new MutationObserver(client, sessionModelMutationOptions(client, 'session-1'));

    await mutation.mutate('provider/new');
    finishRead(initialConfig);
    await staleRead;

    expect(client.getQueryData(queryKey)).toEqual({ ...initialConfig, model: 'provider/new' });
    client.clear();
  });
});

it('shows the actual session model even when the model catalog has not loaded it', () => {
  expect(resolveEffectiveModelId(undefined, 'provider/selected')).toBe('provider/selected');
  expect(resolveEffectiveModelId({ defaultId: 'provider/first', items: [{ id: 'provider/first' }] }, 'provider/selected'))
    .toBe('provider/selected');
});
