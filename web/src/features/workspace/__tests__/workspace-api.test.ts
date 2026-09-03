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

  it('resolves an unscoped path using the configured default space', async () => {
    apiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ space })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ resource })));
    await expect(resolveWorkspaceFileReference('nested/file.html')).resolves.toMatchObject({ fileId: 'file-1' });
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/files/default-space', undefined);
  });

  it('keeps outside-workspace desktop actions when managed resolution rejects the path', async () => {
    const reference = {
      inputPath: '/tmp/report.pdf', displayName: 'report.pdf', absolutePath: '/tmp/report.pdf',
      scope: 'external', exists: true, fileRefId: 'ref-one', capabilities: ['openExternal', 'revealInFolder', 'copyPath'],
    };
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ space })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Outside workspace' } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reference })));
    await expect(resolveWorkspaceFileReference('/tmp/report.pdf', { sessionKey: 'session' })).resolves.toEqual(reference);
    expect(apiFetch).toHaveBeenNthCalledWith(3, '/api/files/resolve-reference', {
      method: 'POST', body: JSON.stringify({ spaceId: space.id, path: '/tmp/report.pdf', sessionKey: 'session' }),
    });
  });

  it('returns no managed reference when the path is unavailable', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 }));
    await expect(resolveWorkspaceFileReference('missing.html', { sessionKey: 'session' })).resolves.toBeNull();
  });
});
