import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchUserProfileSummary } from '../user-profile';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  formatApiHttpError: vi.fn((status: number) => `HTTP ${status}`),
}));

const mockedApiFetch = vi.mocked(apiFetch);

describe('fetchUserProfileSummary', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('returns the mobile understanding summary used by the personal surfaces', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      profile: { callName: 'Mic', role: 'Builder', pronouns: '', timezone: '', locale: '' },
      suggestedCallName: 'Fallback',
      counts: { total: 2, explicit: 1, learned: 1, review: 0, workMemory: 3 },
      goals: [],
      recent: [],
      rules: [],
    }), { status: 200 }));

    await expect(fetchUserProfileSummary()).resolves.toEqual({
      profile: { callName: 'Mic', role: 'Builder', pronouns: '', timezone: '', locale: '' },
      suggestedCallName: 'Fallback',
      counts: { total: 2, explicit: 1, learned: 1, review: 0, workMemory: 3 },
      goals: [],
      recent: [],
      rules: [],
    });
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/user-model/mobile-summary');
  });
});
