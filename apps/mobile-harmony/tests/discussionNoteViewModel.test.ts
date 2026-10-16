import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { byNote: vi.fn(), retry: vi.fn(), organize: vi.fn(), review: vi.fn() };
});

vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { currentProfile: () => ({ gatewayId: 'gateway' }),connectionRevision: () => 1,assertConnection: () => {} } }));
vi.mock('@kit.ArkTS', () => ({ util: { generateRandomUUID: () => 'annotation' } }));
vi.mock('@kit.ArkData', () => ({ relationalStore: {} }));
vi.mock('../entry/src/main/ets/service/discussionReviewPlayback.ets', () => ({ discussionReviewPlayback: { play: vi.fn() } }));
vi.mock('../entry/src/main/ets/repository/discussionCaptureRepository.ets', () => ({
  XopcDiscussionCaptureRepository: class {
    byNote = mocks.byNote;
    retry = mocks.retry;
    organize = mocks.organize;
    review = mocks.review;
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

  it('requests a fresh original-audio generation and continues polling its durable server state', async () => {
    mocks.byNote.mockResolvedValueOnce(result('completed', 'Previous text')).mockResolvedValueOnce(result('sealing', 'Previous text'));
    mocks.retry.mockResolvedValue(undefined);
    const model = new XopcDiscussionNoteViewModel(); model.start('note');
    await vi.waitFor(() => expect(model.detail?.discussion.status).toBe('completed'));
    await model.retry(true);
    expect(mocks.retry).toHaveBeenCalledWith('capture', true);
    expect(model.detail?.transcript.text).toBe('Previous text');
    expect(model.detail?.discussion.status).toBe('sealing'); model.stop();
  });

  it('debounces searches, fences late results and exposes partial chapters and exact source context', async () => {
    mocks.byNote.mockResolvedValue(result('sealing','Previous published words'));
    const partial = { version: 'v',hits: [{ id: 'checkpoint',kind: 'transcript',text: 'Partial words',provisional: true,stale: false,segments: [],playback: [] }],chapters: [],coverage: { complete: false } };
    mocks.review.mockResolvedValue(partial);
    const model = new XopcDiscussionNoteViewModel(); model.start('note');
    await vi.waitFor(() => expect(model.review?.hits[0].text).toBe('Partial words'));
    let resolve!: (value: unknown) => void;
    mocks.review.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    model.setReviewQuery('old'); await vi.advanceTimersByTimeAsync(250);
    mocks.review.mockResolvedValue({ ...partial,hits: [{ ...partial.hits[0],text: 'Current words' }] });
    model.setReviewQuery('new'); await vi.advanceTimersByTimeAsync(250);
    resolve({ ...partial,hits: [{ ...partial.hits[0],text: 'Late words' }] }); await Promise.resolve();
    expect(model.review?.hits[0].text).toBe('Current words');
    model.openReviewEntry(partial.hits[0] as never); expect(model.evidence?.stale).toBe(true);
    model.locateReviewSegment(0); expect(model.tab).toBe('summary');
    model.stop();
  });

  it('locates a distant chapter segment with surrounding text and preserves historical evidence', async () => {
    mocks.byNote.mockResolvedValue({ ...result('completed'),transcript: { revision: 8,segments: Array.from({ length: 100 },(_,sequence) => ({ sequence,status: 'confirmed',startedAtMs: sequence * 1000,endedAtMs: sequence * 1000+1000,displayText: `Text ${sequence}` })) } });
    mocks.review.mockResolvedValue({ hits: [],chapters: [],coverage: {} });
    const model = new XopcDiscussionNoteViewModel(); model.start('note'); await vi.waitFor(() => expect(model.detail).toBeDefined());
    const chapter = { id: 'chapter',kind: 'chapter',title: 'Tail',text: '',transcriptRevision: 8,provisional: true,stale: false,segments: [{ sequence: 80,startedAtMs: 80000,endedAtMs: 81000,text: 'Tail',playback: [] }],playback: [] };
    model.openReviewEntry(chapter); model.locateReviewSegment(80);
    expect(model.transcriptRows().map(row => row.sequence)).toEqual([79,80,81]);
    model.openReviewEntry({ ...chapter,transcriptRevision: 7,stale: true }); model.locateReviewSegment(1);
    expect(model.selectedSegment).toBe(80); model.stop();
  });

  it('retries an initial network failure and resumes polling without losing the Note identity', async () => {
    mocks.byNote.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(result('organizing','Saved words'));
    const model = new XopcDiscussionNoteViewModel();model.start('note');
    await vi.waitFor(() => expect(model.error).toBe('Offline'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(model.detail?.transcript.text).toBe('Saved words');
    for (const call of mocks.byNote.mock.calls) expect(call).toEqual(['note']);
    model.stop();
  });
  it('resumes failed processing and updates stale analysis without retranscribing the audio', async () => {
    mocks.byNote.mockResolvedValue(result('needs_attention','Saved words'));
    const model = new XopcDiscussionNoteViewModel();model.start('note');
    await vi.waitFor(() => expect(model.detail).toBeDefined());
    await model.retryOutcome('pipeline');expect(mocks.retry).toHaveBeenCalledWith('capture',false);
    await model.retryOutcome('analyze');expect(mocks.organize).toHaveBeenCalledWith('capture','general');
    expect(mocks.retry).toHaveBeenCalledTimes(1);model.stop();
  });

});
