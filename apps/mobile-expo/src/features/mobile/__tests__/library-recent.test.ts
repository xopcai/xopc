import { describe, expect, it } from 'vitest';

import { buildLibraryRecentItems } from '../library-recent';

describe('buildLibraryRecentItems', () => {
  it('combines supported library content by recency and excludes directories', () => {
    const items = buildLibraryRecentItems({
      files: [
        { id: 'file', spaceId: 'space', name: 'Plan.pdf', relativePath: 'Plan.pdf', parentPath: '', kind: 'file', mimeType: 'application/pdf', size: 1, modifiedAt: 30, revision: '1', capabilities: [] },
        { id: 'folder', spaceId: 'space', name: 'Folder', relativePath: 'Folder', parentPath: '', kind: 'directory', mimeType: '', size: 0, modifiedAt: 40, revision: '1', capabilities: [] },
      ],
      notes: [{ id: 'note', title: 'Idea', kind: 'thought', status: 'processed', createdAt: 10, updatedAt: 20, capturedVia: { channel: 'app' } } as never],
      recordings: [{ id: 'recording', recordedAt: 50, state: 'saved' }],
      untitledNote: 'Untitled',
      recordingTitle: 'Meeting recording',
    });

    expect(items.map(item => item.id)).toEqual(['recording:recording', 'file:file', 'note:note']);
  });
});
