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

  it('returns the compact profile fields used by the drawer', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      profile: { callName: ' Mic ', role: ' Builder ' },
      suggestedCallName: 'Fallback',
    }), { status: 200 }));

    await expect(fetchUserProfileSummary()).resolves.toEqual({
      callName: 'Mic', role: 'Builder', suggestedCallName: 'Fallback',
    });
  });
});
