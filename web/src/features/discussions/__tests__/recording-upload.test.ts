import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDiscussion, getRecordingChunks, getRecordingJob, uploadRecordingChunk } from '../discussion-api';
import type { DiscussionDraft } from '../discussion-types';
import { uploadDraftRecording } from '../recording-upload';

vi.mock('../discussion-api', () => ({
  getDiscussion: vi.fn(), getRecordingChunks: vi.fn(), getRecordingJob: vi.fn(),
  uploadRecordingChunk: vi.fn(), sealRecording: vi.fn(),
}));
vi.mock('../discussion-draft-store', () => ({
  deleteDiscussionDraft: vi.fn(), getDiscussionDraftChunk: vi.fn(), saveDiscussionDraft: vi.fn(), saveDiscussionDraftChunk: vi.fn(),
}));

describe('recording recovery upload', () => {
  beforeEach(() => vi.clearAllMocks());
  const draft: DiscussionDraft = { id: 'draft', mimeType: 'audio/wav', startedAt: 1, updatedAt: 1, durationMs: 2_000, chunkCount: 1, lastSequence: -1, state: 'stopped' };

  it('does not re-upload chunks that were removed after successful finalization', async () => {
    const detail = { discussion: { id: 'meeting', audioAttachmentId: 'audio' } } as Awaited<ReturnType<typeof getDiscussion>>;
    vi.mocked(getDiscussion).mockResolvedValue(detail);
    expect(await uploadDraftRecording(draft, 'meeting', vi.fn())).toBe(detail);
    expect(getRecordingChunks).not.toHaveBeenCalled();
    expect(uploadRecordingChunk).not.toHaveBeenCalled();
  });

  it('resumes polling the existing job without racing its chunk cleanup', async () => {
    vi.useFakeTimers();
    try {
      const detail = { discussion: { id: 'meeting' }, recordingJob: { id: 'job', discussionId: 'meeting', state: 'running' } } as Awaited<ReturnType<typeof getDiscussion>>;
      vi.mocked(getDiscussion).mockResolvedValueOnce(detail).mockResolvedValueOnce({ ...detail, discussion: { ...detail.discussion, audioAttachmentId: 'audio' } });
      vi.mocked(getRecordingJob).mockResolvedValue({ id: 'job', discussionId: 'meeting', state: 'completed' });
      const upload = uploadDraftRecording(draft, 'meeting', vi.fn());
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await upload)?.discussion.audioAttachmentId).toBe('audio');
      expect(getRecordingChunks).not.toHaveBeenCalled();
      expect(uploadRecordingChunk).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
