import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ detail: vi.fn(), chunks: vi.fn(), chunk: vi.fn(), upload: vi.fn(), seal: vi.fn(), job: vi.fn(), save: vi.fn() }));
vi.mock('../discussion-api', () => ({ getDiscussion: mocks.detail, getRecordingChunks: mocks.chunks,
  uploadRecordingChunk: mocks.upload, sealRecording: mocks.seal, getRecordingJob: mocks.job }));
vi.mock('../discussion-draft-store', () => ({ getDiscussionDraftChunk: mocks.chunk, saveDiscussionDraft: mocks.save,
  saveDiscussionDraftChunk: vi.fn(), deleteDiscussionDraft: vi.fn() }));

import { uploadDraftRecording } from '../recording-upload';
import type { DiscussionDraft } from '../discussion-types';

const draft: DiscussionDraft = { id: 'local', startedAt: 1, updatedAt: 1, durationMs: 5_000, chunkCount: 1,
  lastSequence: -1, mimeType: 'audio/webm', state: 'stopped', saveOutcome: 'complete' };
const pending = { discussion: { id: 'server', status: 'stopping' } };
const ready = { discussion: { ...pending.discussion, audioAttachmentId: 'original' } };
beforeEach(() => {
  vi.resetAllMocks(); mocks.detail.mockResolvedValue(pending); mocks.chunks.mockResolvedValue([]);
  mocks.chunk.mockResolvedValue({ blob: new Blob(['stored audio']) }); mocks.upload.mockResolvedValue(undefined);
  mocks.seal.mockResolvedValue({ id: 'job', state: 'completed' });
});

describe('original audio sync confirmation', () => {
  it('persists the immutable seal intent before network submission and sends independent epoch boundaries', async () => {
    const epochs = [{ firstChunk: 0, mimeType: 'audio/webm', startedAt: 1 }, { firstChunk: 1, mimeType: 'audio/webm', startedAt: 9000 }];
    mocks.chunk.mockResolvedValue({ blob: new Blob(['source']) });
    mocks.seal.mockRejectedValue(new Error('RESPONSE_LOST'));
    await expect(uploadDraftRecording({ ...draft, chunkCount: 2, epochs }, 'server', vi.fn())).rejects.toThrow('RESPONSE_LOST');
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'local', sealRequested: true, serverDiscussionId: 'server', epochs }));
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.seal.mock.invocationCallOrder[0]);
    expect(mocks.seal).toHaveBeenCalledWith('server', expect.objectContaining({ epochs, chunkCount: 2 }));
  });

  it('reports verification rather than availability at 100% and waits for a confirmed attachment', async () => {
    let confirm!: (value: typeof ready) => void;
    mocks.detail.mockResolvedValueOnce(pending).mockImplementationOnce(() => new Promise(done => { confirm = done; }));
    const stage = vi.fn(); const progress = vi.fn();
    const uploading = uploadDraftRecording(draft, 'server', progress, true, stage);
    await vi.waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
    expect(progress).toHaveBeenLastCalledWith(100); expect(stage).toHaveBeenLastCalledWith('verifying');
    expect(stage).not.toHaveBeenCalledWith('available');
    confirm(ready); expect(await uploading).toEqual(ready); expect(stage).toHaveBeenLastCalledWith('available');
  });
  it('does not turn a completed job without its audio attachment into success', async () => {
    const stage = vi.fn();
    await expect(uploadDraftRecording(draft, 'server', vi.fn(), true, stage)).rejects.toThrow('not confirmed');
    expect(stage).not.toHaveBeenCalledWith('available');
  });
  it('does not report a deleted attachment as available or silently upload it again', async () => {
    mocks.detail.mockResolvedValue({ discussion: { ...ready.discussion, audioDeletedAt: 1 } });
    const stage = vi.fn();
    await expect(uploadDraftRecording(draft, 'server', vi.fn(), true, stage)).rejects.toThrow('deleted');
    expect(stage).not.toHaveBeenCalledWith('available'); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('does not describe a fully uploaded active prefix as a complete recording', async () => {
    const stage = vi.fn();
    await uploadDraftRecording({ ...draft, state: 'recording' }, 'server', vi.fn(), false, stage);
    expect(stage).toHaveBeenLastCalledWith('pending'); expect(mocks.seal).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalledWith('verifying'); expect(stage).not.toHaveBeenCalledWith('available');
  });
});
