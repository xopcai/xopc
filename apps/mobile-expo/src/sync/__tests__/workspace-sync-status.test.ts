import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../storage/mmkv', () => ({
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => memory.set(key, String(value)),
    delete: (key: string) => memory.delete(key),
  },
}));

vi.mock('../../query/notes', () => ({
  deleteNote: vi.fn(),
  moveNoteToGroup: vi.fn(),
  quickCaptureNote: vi.fn(),
  recordNoteOpen: vi.fn(),
  updateNote: vi.fn(),
}));

import {
  clearWorkspaceSyncDeadLetters,
  clearWorkspaceSyncQueue,
  getWorkspaceSyncStatus,
  queueWorkspaceCapture,
  subscribeWorkspaceSyncStatus,
} from '../workspace-sync';
import { listSyncJournalEntries } from '../sync-journal';

describe('workspace sync status', () => {
  beforeEach(() => {
    memory.clear();
    clearWorkspaceSyncQueue();
    clearWorkspaceSyncDeadLetters();
  });

  it('notifies the UI immediately when an operation is queued', () => {
    const onStatusChange = vi.fn();
    const unsubscribe = subscribeWorkspaceSyncStatus(onStatusChange);

    queueWorkspaceCapture('Remember this');

    expect(getWorkspaceSyncStatus()).toEqual({ pendingCount: 1, failedCount: 0 });
    expect(listSyncJournalEntries()).toEqual([expect.objectContaining({
      entity: 'note', kind: 'create_note', payload: { text: 'Remember this' },
    })]);
    expect(onStatusChange).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('returns a cached snapshot until the sync status changes', () => {
    const initialStatus = getWorkspaceSyncStatus();

    expect(getWorkspaceSyncStatus()).toBe(initialStatus);

    queueWorkspaceCapture('Cache this snapshot');

    const queuedStatus = getWorkspaceSyncStatus();
    expect(queuedStatus).toEqual({ pendingCount: 1, failedCount: 0 });
    expect(queuedStatus).not.toBe(initialStatus);
    expect(getWorkspaceSyncStatus()).toBe(queuedStatus);
  });
});
