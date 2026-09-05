import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayConnectivityError } from '../../api/gateway-error';

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

vi.mock('../../features/notes/capture-note-media', () => ({
  captureNoteWithVoice: vi.fn(),
}));

vi.mock('../../features/chat/voiceRecording', () => ({
  deleteRecordingFile: vi.fn(),
}));

import {
  clearWorkspaceSyncDeadLetters,
  clearWorkspaceSyncQueue,
  captureWorkspaceText,
  captureWorkspaceVoice,
  flushPendingWorkspaceOperations,
  getWorkspaceSyncStatus,
  queueWorkspaceCapture,
  queueWorkspaceOperation,
  getPendingWorkspaceOperations,
  subscribeWorkspaceSyncStatus,
} from '../workspace-sync';
import { listSyncJournalEntries } from '../sync-journal';

describe('workspace sync status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memory.clear();
    clearWorkspaceSyncQueue();
    clearWorkspaceSyncDeadLetters();
  });

  it.each([true, false])('preserves the newest draft when an older in-flight save fails=%s', async (fails) => {
    const { updateNote } = await import('../../query/notes');
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(updateNote).mockImplementationOnce(async () => {
      await gate;
      if (fails) throw new Error('network failed');
      return { id: 'note-1', markdown: 'A' } as Awaited<ReturnType<typeof updateNote>>;
    });
    queueWorkspaceOperation({ type: 'update_note', noteId: 'note-1', patch: { markdown: 'A' } });
    const flushing = flushPendingWorkspaceOperations();
    queueWorkspaceOperation({ type: 'update_note', noteId: 'note-1', patch: { markdown: 'B' } });
    queueWorkspaceOperation({ type: 'update_note', noteId: 'note-1', patch: { markdown: 'C' } });
    finish();
    await flushing;
    expect(getPendingWorkspaceOperations().at(-1)?.payload).toMatchObject({ patch: { markdown: 'C' } });

    vi.mocked(updateNote).mockResolvedValue({ id: 'note-1', markdown: 'C' } as Awaited<ReturnType<typeof updateNote>>);
    await flushPendingWorkspaceOperations();
    expect(vi.mocked(updateNote).mock.calls.at(-1)).toEqual(['note-1', { markdown: 'C' }]);
    expect(getWorkspaceSyncStatus().pendingCount).toBe(0);
    expect(listSyncJournalEntries()).toEqual([]);
  });

  it('merges pending patches without discarding unrelated fields', () => {
    queueWorkspaceOperation({ type: 'update_note', noteId: 'note-1', patch: { markdown: 'A', tags: ['work'] } });
    queueWorkspaceOperation({ type: 'update_note', noteId: 'note-1', patch: { markdown: 'B' } });
    expect(getPendingWorkspaceOperations()).toHaveLength(1);
    expect(getPendingWorkspaceOperations()[0].payload).toMatchObject({ patch: { markdown: 'B', tags: ['work'] } });
    expect(listSyncJournalEntries()).toHaveLength(1);
  });

  it('notifies the UI immediately when an operation is queued', () => {
    const onStatusChange = vi.fn();
    const unsubscribe = subscribeWorkspaceSyncStatus(onStatusChange);

    queueWorkspaceCapture({ text: 'Remember this', channel: 'app' });

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

    queueWorkspaceCapture({ text: 'Cache this snapshot', channel: 'app' });

    const queuedStatus = getWorkspaceSyncStatus();
    expect(queuedStatus).toEqual({ pendingCount: 1, failedCount: 0 });
    expect(queuedStatus).not.toBe(initialStatus);
    expect(getWorkspaceSyncStatus()).toBe(queuedStatus);
  });

  it('uses the queue id as the server idempotency key and clears the journal after sync', async () => {
    const { quickCaptureNote } = await import('../../query/notes');
    vi.mocked(quickCaptureNote).mockResolvedValue({ note: { id: 'note-1' } });

    const operationId = queueWorkspaceCapture({ text: 'Durable thought', channel: 'share' });
    expect(await flushPendingWorkspaceOperations()).toBe(1);

    expect(quickCaptureNote).toHaveBeenCalledWith('Durable thought', {
      channel: 'share',
      idempotencyKey: operationId,
    });
    expect(getWorkspaceSyncStatus()).toEqual({ pendingCount: 0, failedCount: 0 });
    expect(listSyncJournalEntries()).toEqual([]);
  });

  it('returns the synced note id to the initiating capture flow', async () => {
    const { quickCaptureNote } = await import('../../query/notes');
    vi.mocked(quickCaptureNote).mockResolvedValue({ note: { id: 'note-from-share' } });

    await expect(captureWorkspaceText({ text: 'Open after saving', channel: 'share' }))
      .resolves.toMatchObject({ synced: true, noteId: 'note-from-share' });
  });

  it('keeps failed captures durable and records the sync error', async () => {
    const { quickCaptureNote } = await import('../../query/notes');
    vi.mocked(quickCaptureNote).mockRejectedValue(new Error('gateway offline'));

    await expect(captureWorkspaceText({ text: 'Keep me', channel: 'clipboard' }))
      .resolves.toMatchObject({ synced: false });

    expect(getWorkspaceSyncStatus()).toEqual({ pendingCount: 1, failedCount: 0 });
    expect(listSyncJournalEntries()).toEqual([expect.objectContaining({
      state: 'pending',
      retryCount: 1,
      error: 'gateway offline',
    })]);
  });

  it('does not exhaust the retry budget while the gateway is unreachable', async () => {
    const { quickCaptureNote } = await import('../../query/notes');
    vi.mocked(quickCaptureNote).mockRejectedValue(
      new GatewayConnectivityError('no-route', 'Could not reach gateway'),
    );

    await expect(captureWorkspaceText({ text: 'Wait for the gateway', channel: 'app' }))
      .resolves.toMatchObject({ synced: false });

    expect(getWorkspaceSyncStatus()).toEqual({ pendingCount: 1, failedCount: 0 });
    expect(listSyncJournalEntries()).toEqual([expect.objectContaining({
      state: 'pending',
      retryCount: 0,
      error: 'Could not reach gateway',
    })]);
  });

  it('keeps voice captures durable and reuses the queue id as the media idempotency key', async () => {
    const { captureNoteWithVoice } = await import('../../features/notes/capture-note-media');
    const { deleteRecordingFile } = await import('../../features/chat/voiceRecording');
    vi.mocked(captureNoteWithVoice).mockResolvedValue({ note: { id: 'voice-note-1' } });

    const result = await captureWorkspaceVoice({
      uri: 'file:///documents/voice.m4a',
      durationMillis: 2_400,
      mimeType: 'audio/mp4',
    });

    expect(result).toMatchObject({ synced: true, noteId: 'voice-note-1' });
    const [, options] = vi.mocked(captureNoteWithVoice).mock.calls[0];
    expect(options?.idempotencyKey).toBe(result.operationId);
    expect(deleteRecordingFile).toHaveBeenCalledWith('file:///documents/voice.m4a');
    expect(getWorkspaceSyncStatus()).toEqual({ pendingCount: 0, failedCount: 0 });
  });
});
