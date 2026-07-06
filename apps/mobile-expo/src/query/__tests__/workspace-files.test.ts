import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchWorkspaceDir } from '../workspace-files';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  formatApiHttpError: vi.fn((status: number, statusText: string, message?: string) =>
    message ? `${status} ${statusText}: ${message}` : `${status} ${statusText}`,
  ),
}));

const mockedApiFetch = vi.mocked(apiFetch);

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe('fetchWorkspaceDir', () => {
  it('normalizes workspace entries before returning them to UI lists', async () => {
    mockedApiFetch.mockResolvedValue(
      okJson({
        ok: true,
        payload: {
          entries: [
            {
              name: null,
              path: '/reports/final.md',
              absolutePath: 42,
              isDirectory: false,
              size: Number.NaN,
            },
            {
              path: 'nested',
              type: 'directory',
              mtimeMs: 123,
            },
          ],
        },
      }),
    );

    await expect(fetchWorkspaceDir({ dir: '/reports/' })).resolves.toEqual([
      {
        name: 'final.md',
        path: 'reports/final.md',
        isDirectory: false,
      },
      {
        name: 'nested',
        path: 'nested',
        isDirectory: true,
        mtimeMs: 123,
      },
    ]);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/workspace/editor/list?dir=reports');
  });
});
