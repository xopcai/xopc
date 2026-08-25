import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../../api/client';
import { readWorkspaceFile, readWorkspaceFileBase64 } from '../workspace-api';

vi.mock('../../../api/client', () => ({
  apiFetch: vi.fn(),
  formatApiHttpError: vi.fn((status: number) => `HTTP ${status}`),
}));

const mockedApiFetch = vi.mocked(apiFetch);

describe('project workspace reads', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('reads project text through the project file endpoint', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: { content: '# Brief', path: 'docs/brief.md' },
    })));

    await expect(readWorkspaceFile('docs/brief.md', { projectId: 'project/one' }))
      .resolves.toMatchObject({ content: '# Brief' });
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/projects/project%2Fone/files/read?path=docs%2Fbrief.md');
  });

  it('reads project binary data through the raw endpoint', async () => {
    mockedApiFetch.mockResolvedValue(new Response(new Uint8Array([65, 66, 67])));

    await expect(readWorkspaceFileBase64('image.png', { projectId: 'project-1' }))
      .resolves.toEqual({ contentBase64: 'QUJD', path: 'image.png' });
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/projects/project-1/files/raw?path=image.png');
  });
});
