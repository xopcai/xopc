import { beforeEach, describe, expect, it, vi } from 'vitest';

import { searchFiles } from '../files';
import { fetchNotes } from '../notes';
import { searchMobileLibrary } from '../search';

vi.mock('../files', () => ({ searchFiles: vi.fn() }));
vi.mock('../notes', () => ({ fetchNotes: vi.fn() }));

const mockedSearchFiles = vi.mocked(searchFiles);
const mockedFetchNotes = vi.mocked(fetchNotes);

describe('mobile library search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchNotes.mockResolvedValue({
      items: [{ id: 'note-1', kind: 'thought', status: 'processed', createdAt: 1, updatedAt: 5, title: 'Launch note' }],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    });
    mockedSearchFiles.mockResolvedValue([
      { id: 'file-1', spaceId: 'space', name: 'Launch.pdf', relativePath: 'Launch.pdf', parentPath: '', kind: 'file', mimeType: 'application/pdf', size: 1, modifiedAt: 6, revision: '1', capabilities: [] },
      { id: 'folder-1', spaceId: 'space', name: 'Launch', relativePath: 'Launch', parentPath: '', kind: 'directory', mimeType: '', size: 0, modifiedAt: 7, revision: '1', capabilities: [] },
    ]);
  });

  it('returns only notes and files with native routes', async () => {
    const hits = await searchMobileLibrary('launch');
    expect(hits.map(hit => hit.kind)).toEqual(['file', 'note']);
    expect(hits[0]?.route).toBe('/files/open/file-1');
    expect(hits[1]?.route).toBe('/items/note-1');
  });
});
