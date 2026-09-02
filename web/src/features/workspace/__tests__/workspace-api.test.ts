import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/fetch', () => ({ apiFetch }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));

import { resolveWorkspaceFileReference } from '../workspace-api';

const space = {
  id: 'space-1', title: 'Project', kind: 'workspace', bindings: [{ kind: 'project', id: 'project one' }], writable: true,
};
const resource = {
  id: 'file-1', spaceId: 'space-1', name: 'file.html', relativePath: 'nested/file.html', parentPath: 'nested',
  kind: 'file', mimeType: 'text/html', size: 12, modifiedAt: 10, revision: '10:1:12', capabilities: ['preview', 'edit'],
};

describe('resolveWorkspaceFileReference', () => {
  beforeEach(() => apiFetch.mockReset());

  it('resolves a project path through its managed file space', async () => {
    apiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ space })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ resource })));

    await expect(resolveWorkspaceFileReference('nested/file.html', { projectId: 'project one' }))
      .resolves.toMatchObject({ fileId: 'file-1', workspaceRelativePath: 'nested/file.html' });
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/files/contexts/project/project%20one', undefined);
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/files/resolve', {
      method: 'POST',
      body: JSON.stringify({ spaceId: 'space-1', path: 'nested/file.html' }),
    });
  });

  it('returns no managed reference when the path is unavailable', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 }));
    await expect(resolveWorkspaceFileReference('missing.html', { sessionKey: 'session' })).resolves.toBeNull();
  });
});
