import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchSessionAgentConfig } from '../models';

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
