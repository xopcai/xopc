import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/fetch', () => ({ apiFetch, fetchJson: vi.fn() }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));

import { resolveWorkspaceFileReference } from '../workspace-api';

describe('resolveWorkspaceFileReference', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('prefers the project file endpoint over session workspace resolution', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: {
        inputPath: 'nested/file.html',
        displayName: 'file.html',
        scope: 'workspace',
        exists: true,
        workspaceRelativePath: 'nested/file.html',
        capabilities: ['preview'],
      },
    }), { status: 200 }));

    await resolveWorkspaceFileReference('nested/file.html', {
      projectId: 'project one',
      sessionKey: 'agent:main:webchat:default:direct:stale',
    });

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/projects/project%20one/files/resolve-reference?path=nested%2Ffile.html',
    );
  });

  it('preserves gateway access errors instead of returning a missing reference', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: { code: 'FILE_ACCESS_DENIED', message: 'Gateway does not have permission to access this file' },
    }), { status: 403 }));

    await expect(resolveWorkspaceFileReference('/private/file.html', { sessionKey: 'session' }))
      .rejects.toThrow('Gateway does not have permission to access this file');
  });
});
