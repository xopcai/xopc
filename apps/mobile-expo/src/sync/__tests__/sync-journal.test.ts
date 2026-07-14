import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../storage/mmkv', () => ({
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => memory.set(key, String(value)),
    delete: (key: string) => memory.delete(key),
  },
}));

import {
  appendSyncJournalEntry,
  clearSyncJournalForTests,
  listSyncJournalEntries,
  readySyncJournalEntries,
  updateSyncJournalEntry,
} from '../sync-journal';

describe('sync journal', () => {
  beforeEach(() => {
    memory.clear();
    clearSyncJournalForTests();
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));
  });

  it('persists an offline operation with dependency and base-version metadata', () => {
    appendSyncJournalEntry({
      id: 'upload-1', entity: 'attachment', entityId: 'local:note-1', kind: 'upload_attachment',
      payload: { uri: 'file:///photo.jpg' }, baseVersion: 2, localVersion: 3, dependsOn: ['note-1', 'note-1'],
    });

    expect(listSyncJournalEntries()).toEqual([expect.objectContaining({
      id: 'upload-1', state: 'pending', retryCount: 0, dependsOn: ['note-1'], baseVersion: 2,
    })]);
  });

  it('marks a server version conflict without discarding the local payload', () => {
    appendSyncJournalEntry({
      id: 'edit-1', entity: 'note', entityId: 'note-1', kind: 'update_note',
      payload: { markdown: 'local edit' }, localVersion: 4, dependsOn: [],
    });

    updateSyncJournalEntry('edit-1', { state: 'conflict', error: 'VERSION_CONFLICT' });

    expect(listSyncJournalEntries()[0]).toMatchObject({
      state: 'conflict', error: 'VERSION_CONFLICT', payload: { markdown: 'local edit' },
    });
  });

  it('does not run an attachment until its note creation has completed', () => {
    const note = appendSyncJournalEntry({
      id: 'note-1', entity: 'note', entityId: 'local:note-1', kind: 'create_note',
      payload: {}, localVersion: 1, dependsOn: [],
    });
    const attachment = appendSyncJournalEntry({
      id: 'attachment-1', entity: 'attachment', entityId: 'local:note-1', kind: 'upload_attachment',
      payload: {}, localVersion: 1, dependsOn: ['note-1'],
    });

    expect(readySyncJournalEntries([note, attachment])).toEqual([note]);
    expect(readySyncJournalEntries([note, attachment], ['note-1'])).toEqual([note, attachment]);
  });
});
