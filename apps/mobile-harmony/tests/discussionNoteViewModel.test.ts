import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { byNote: vi.fn(), retry: vi.fn() };
});

vi.mock('../entry/src/main/ets/repository/discussionCaptureRepository.ets', () => ({
  XopcDiscussionCaptureRepository: class {
    byNote = mocks.byNote;
    retry = mocks.retry;
  },
}));

import { XopcDiscussionNoteViewModel } from '../entry/src/main/ets/viewmodel/discussionNoteViewModel.ets';

const result = (status: string, text: string = '') => ({
  discussion: { id: 'capture', noteId: 'note', status },
  transcript: { discussionId: 'capture', revision: 1, text,
    segments: text ? [{ sequence: 0, status: 'confirmed', startedAtMs: 0, endedAtMs: 2000, displayText: text }] : [] },
  ...(status === 'completed' ? { organization: { status: 'completed', organization: {
    summary: 'Summary', keyPoints: [], decisions: [], actionItems: [], risks: [], openQuestions: [],
  } } } : {}),
});

describe('voice note discussion detail', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('polls an unfinished recording and exposes its transcript and summary when complete', async () => {
    mocks.byNote.mockResolvedValueOnce(result('stopping')).mockResolvedValueOnce(result('completed', 'Recorded words'));
    const model = new XopcDiscussionNoteViewModel();
    model.start('note');
    await vi.waitFor(() => expect(model.detail?.discussion.status).toBe('stopping'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(model.detail?.transcript.text).toBe('Recorded words');
    expect(model.detail?.organization?.organization?.summary).toBe('Summary');
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.byNote).toHaveBeenCalledTimes(2);
    model.stop();
  });

  it('discards a late response after leaving the note', async () => {
    let finish!: (value: unknown) => void;
    mocks.byNote.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const model = new XopcDiscussionNoteViewModel();
    model.start('note');
    model.stop();
    finish(result('completed', 'Late words'));
    await Promise.resolve();
    expect(model.detail).toBeUndefined();
  });
});
