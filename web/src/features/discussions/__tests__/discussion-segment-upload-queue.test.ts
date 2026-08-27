import { describe, expect, it, vi } from 'vitest';

import { drainDiscussionSegmentUploadQueue } from '../discussion-segment-upload-queue';
import type { DiscussionTranscript } from '../discussion-types';

function transcript(sequence: number): DiscussionTranscript {
  return {
    discussionId: 'discussion-1',
    revision: sequence + 1,
    segments: [],
    text: String(sequence),
    stats: { uploaded: 0, transcribing: 0, confirmed: sequence + 1, failed: 0 },
  };
}

describe('discussion segment upload queue', () => {
  it('drains durable segments in order and removes only acknowledged entries', async () => {
    const pending = [{ sequence: 0 }, { sequence: 1 }, { sequence: 2 }];
    const uploaded: number[] = [];
    const counts: number[] = [];

    await drainDiscussionSegmentUploadQueue(
      { draftId: 'draft-1', discussionId: 'discussion-1' },
      {
        list: async () => [...pending],
        upload: async (_discussionId, segment) => {
          uploaded.push(segment.sequence);
          return transcript(segment.sequence);
        },
        remove: async (_draftId, segment) => {
          pending.splice(pending.findIndex((entry) => entry.sequence === segment.sequence), 1);
        },
        onPendingCount: (count) => counts.push(count),
      },
      new AbortController().signal,
    );

    expect(uploaded).toEqual([0, 1, 2]);
    expect(counts).toEqual([3, 2, 1, 0]);
  });

  it('retries a failed upload without deleting its durable segment', async () => {
    vi.useFakeTimers();
    const pending = [{ sequence: 0 }];
    const upload = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { retryAfterMs: 0 }))
      .mockResolvedValueOnce(transcript(0));
    const draining = drainDiscussionSegmentUploadQueue(
      { draftId: 'draft-1', discussionId: 'discussion-1' },
      {
        list: async () => [...pending],
        upload,
        remove: async () => { pending.length = 0; },
      },
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();
    await draining;

    expect(upload).toHaveBeenCalledTimes(2);
    expect(pending).toHaveLength(0);
    vi.useRealTimers();
  });

  it('does not retry permanent validation failures', async () => {
    const pending = [{ sequence: 0 }];
    const upload = vi.fn().mockRejectedValue(Object.assign(new Error('invalid checksum'), { status: 400 }));

    await expect(drainDiscussionSegmentUploadQueue(
      { draftId: 'draft-1', discussionId: 'discussion-1' },
      {
        list: async () => [...pending],
        upload,
        remove: async () => { pending.length = 0; },
      },
      new AbortController().signal,
    )).rejects.toThrow('invalid checksum');

    expect(upload).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);
  });

  it('drains a long recovered recording without reordering or dropping segments', async () => {
    const pending = Array.from({ length: 250 }, (_, sequence) => ({ sequence }));
    const uploaded: number[] = [];

    await drainDiscussionSegmentUploadQueue(
      { draftId: 'recovered-draft', discussionId: 'discussion-1' },
      {
        list: async () => [...pending],
        upload: async (_discussionId, segment) => {
          uploaded.push(segment.sequence);
          return transcript(segment.sequence);
        },
        remove: async (_draftId, segment) => {
          pending.splice(pending.findIndex((entry) => entry.sequence === segment.sequence), 1);
        },
      },
      new AbortController().signal,
    );

    expect(uploaded).toEqual(Array.from({ length: 250 }, (_, sequence) => sequence));
    expect(pending).toHaveLength(0);
  });
});
