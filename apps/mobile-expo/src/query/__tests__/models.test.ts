import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchSessionAgentConfig, setSessionModelRef } from '../models';

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
});
