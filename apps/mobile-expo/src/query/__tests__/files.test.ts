import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchFileChildren, fetchFileHostPath, fetchFileResource, resolveFileResource, uploadFileResource } from '../files';
import { fetchHostDirectories } from '../host-fs';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  formatApiHttpError: (status: number, _text: string, message?: string) => message ?? `HTTP ${status}`,
}));

const fetch = vi.mocked(apiFetch);
beforeEach(() => fetch.mockReset());

describe('managed file requests', () => {
  it('propagates listing errors instead of returning an empty directory', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Workspace unavailable' } }), { status: 404 }));
    await expect(fetchFileChildren('space', 'docs')).rejects.toThrow('Workspace unavailable');
  });

  it('propagates a direct file-open error so the screen can retry', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'File not found' } }), { status: 404 }));
    await expect(fetchFileResource('space.file')).rejects.toThrow('File not found');
    expect(fetch).toHaveBeenCalledWith('/api/files/space.file');
  });

  it('copies the resolved host path from the selected file ID', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ absolutePath: '/session/docs/note.md' })));
    await expect(fetchFileHostPath('space.file')).resolves.toBe('/session/docs/note.md');
    expect(fetch).toHaveBeenCalledWith('/api/files/space.file/host-path');
  });

  it('resolves a workspace root for folder sharing', async () => {
    const resource = { id: 'space.', spaceId: 'space', name: 'Workspace', relativePath: '', parentPath: '',
      kind: 'directory', mimeType: 'inode/directory', size: 0, modifiedAt: 0, revision: '1', capabilities: ['share', 'upload'] };
    fetch.mockResolvedValue(new Response(JSON.stringify({ resource })));
    await expect(resolveFileResource('space', '.')).resolves.toEqual(resource);
    expect(fetch).toHaveBeenCalledWith('/api/files/resolve', { method: 'POST', body: JSON.stringify({ spaceId: 'space', path: '.' }) });
  });

  it('preserves upload conflicts for the failure notice', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'File already exists' } }), { status: 409 }));
    await expect(uploadFileResource({ spaceId: 'space', directory: 'docs', uri: 'file:///tmp/note.txt', name: 'note.txt' }))
      .rejects.toThrow('File already exists');
  });

  it('lists only host directories for the working-folder picker', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ payload: {
      currentPath: '/work',
      parentPath: '/',
      entries: [
        { name: 'repo', absolutePath: '/work/repo', isDirectory: true },
        { name: 'readme.md', absolutePath: '/work/readme.md', isDirectory: false },
      ],
    } })));

    await expect(fetchHostDirectories('/work')).resolves.toMatchObject({
      entries: [{ name: 'repo', absolutePath: '/work/repo', isDirectory: true }],
    });
    expect(fetch).toHaveBeenCalledWith('/api/host/fs/list?path=%2Fwork');
  });
});
