// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const recorder: Record<string, unknown> = {};
  return { recorder, pathname: '/notes', create: vi.fn(), settings: vi.fn(), get: vi.fn(),
    upload: vi.fn(), cancel: vi.fn(), navigate: vi.fn(), drain: vi.fn(), annotations: vi.fn(async () => {}) };
});
vi.mock('../discussion-annotation-sync', () => ({ syncDiscussionAnnotations: mocks.annotations }));
vi.mock('../use-discussion-recorder', () => ({ useDiscussionRecorder: () => mocks.recorder }));
vi.mock('../discussion-api', () => ({
  createDiscussion: mocks.create, getDiscussionCaptureSettings: mocks.settings, getDiscussion: mocks.get,
  getDiscussionTranscript: vi.fn(async () => ({ text: '' })),
  acknowledgeDiscussionConsent: vi.fn(), cancelDiscussion: mocks.cancel, unlinkDiscussionProject: vi.fn(), uploadDiscussionSegment: vi.fn(),
}));
vi.mock('../recording-upload', () => ({ uploadDraftRecording: mocks.upload }));
vi.mock('../discussion-draft-store', () => ({
  deleteDiscussionLiveSegment: vi.fn(), listDiscussionLiveSegments: async () => [], saveDiscussionLiveSegment: vi.fn(),
}));
vi.mock('../discussion-segment-upload-queue', () => ({ drainDiscussionSegmentUploadQueue: mocks.drain }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate, useLocation: () => ({ pathname: mocks.pathname }) }));
vi.mock('@/stores/gateway-store', () => ({ useGatewayStore: Object.assign(
  (selector: (state: { conversationId: string }) => unknown) => selector({ conversationId: 'session' }),
  { getState: () => ({ baseUrl: window.location.origin }) },
) }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'en' }) }));

import { GlobalDiscussionCaptureHost } from '../global-discussion-capture';
import { OPEN_DISCUSSION_CAPTURE_EVENT } from '../discussion-events';
import { rememberDiscussionConsent } from '../discussion-consent-cache';
import { messages } from '@/i18n/messages';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const draft = { id: 'local', startedAt: 42, durationMs: 5_000, chunkCount: 1, lastSequence: -1,
  mimeType: 'audio/webm', state: 'stopped', saveOutcome: 'complete', consentPolicyVersion: 1 };
const detail = { discussion: { id: 'server', status: 'stopping', audioAttachmentId: 'audio' }, note: { id: 'note', title: 'Note' } };
const copy = messages('en').notes.discussionCapture;
async function click(label: string) {
  await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === label)!.click(); });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); localStorage.clear(); mocks.pathname = '/notes';
  rememberDiscussionConsent({ consentPolicyVersion: 1, consentAcknowledgedAt: 1 });
  Object.assign(mocks.recorder, {
    phase: 'idle', draft, recoverableDrafts: [draft], elapsedMs: 5_000, liveTranscriptionAvailable: true, error: null,
    start: vi.fn(async () => { mocks.recorder.phase = 'recording'; return draft; }),
    stop: vi.fn(async () => { mocks.recorder.phase = 'stopped'; return draft; }),
    restore: vi.fn(async () => { mocks.recorder.phase = 'stopped'; return draft; }),
    setServerDiscussionId: vi.fn(async () => {}), discard: vi.fn(async () => {}),
    markUploadFailed: vi.fn(async () => {}), refreshRecoverableDrafts: vi.fn(), pause: vi.fn(), resume: vi.fn(),
  });
  mocks.create.mockResolvedValue(detail); mocks.get.mockResolvedValue(detail); mocks.upload.mockResolvedValue(detail);
  mocks.drain.mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<GlobalDiscussionCaptureHost />); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('recording completion and recovery orchestration', () => {
  it('retains the confirmed original duration after local recorder state is released', async () => {
    mocks.get.mockResolvedValue({ ...detail, discussion: { ...detail.discussion, durationMs: 7200840 } });
    await click(copy.recover);
    Object.assign(mocks.recorder, { elapsedMs: 0, draft: null });
    await act(async () => root.render(<GlobalDiscussionCaptureHost />));
    expect(container.textContent).toContain('120:00');
  });

  it('dismisses the finished recording when its confirmed Note is opened through navigation', async () => {
    await click(copy.recover);
    mocks.pathname = '/notes/note';
    await act(async () => root.render(<GlobalDiscussionCaptureHost />));
    expect(container.querySelector('[data-recording-window]')).toBeNull();
  });

  it('lists and discards the chosen recording without cancelling a Note or touching another draft', async () => {
    mocks.recorder.recoverableDrafts = [draft, { ...draft, id: 'second', serverDiscussionId: 'second-server', startedAt: 200 }];
    await act(async () => { window.dispatchEvent(new Event('open-recording-recoveries')); });
    const articles = container.querySelectorAll('article'); expect(articles).toHaveLength(2);
    await act(async () => { [...articles[1].querySelectorAll('button')].find(button => button.textContent === 'Discard local copy')!.click(); });
    expect(mocks.recorder.discard).toHaveBeenCalledWith('second');
    expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('recovers the selected draft without creating a replacement Note when its known server is unavailable', async () => {
    const selected = { ...draft, id: 'second', serverDiscussionId: 'existing' };
    mocks.recorder.recoverableDrafts = [draft, selected];
    mocks.recorder.restore = vi.fn(async (candidate) => candidate);
    mocks.get.mockRejectedValue(new Error('OFFLINE'));
    await act(async () => { window.dispatchEvent(new Event('open-recording-recoveries')); });
    await act(async () => { [...container.querySelectorAll('article')[1].querySelectorAll('button')].find(button => button.textContent === copy.recover)!.click(); });
    expect(mocks.recorder.restore).toHaveBeenCalledWith(selected);
    expect(mocks.get).toHaveBeenCalledWith('existing'); expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.recorder.discard).not.toHaveBeenCalled();
  });
  it('continues into the existing recording identity and refuses recovery actions during capture', async () => {
    mocks.recorder.recoverableDrafts = [{ ...draft, serverDiscussionId: 'existing' }];
    mocks.get.mockResolvedValue({ ...detail, discussion: { id: 'existing', status: 'recording' } });
    await act(async () => { window.dispatchEvent(new Event('open-recording-recoveries')); });
    await click('Continue recording');
    expect(mocks.recorder.start).toHaveBeenCalledWith(expect.objectContaining({ continuation: expect.objectContaining({ id: 'local' }) }));
    expect(mocks.create).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event('open-recording-recoveries')); });
    for (const button of container.querySelectorAll('article button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps interrupted audio open for continuation instead of automatically sealing it', async () => {
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    mocks.recorder.phase = 'stopped'; mocks.recorder.draft = { ...draft, saveOutcome: 'interrupted' };
    await act(async () => { root.render(<GlobalDiscussionCaptureHost />); });
    expect(mocks.recorder.stop).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Continue recording');
    expect(mocks.upload.mock.calls.filter(call => call[3] !== false)).toHaveLength(0);
  });

  it('shows local completion only after its barrier and independently of an unconfirmed server upload', async () => {
    let finishStop!: () => void; let finishUpload!: () => void;
    mocks.recorder.stop = vi.fn(async () => {
      mocks.recorder.phase = 'stopping';
      await new Promise<void>(done => { finishStop = done; });
      mocks.recorder.phase = 'stopped'; return draft;
    });
    mocks.upload.mockImplementation(async (_draft, _id, progress, _complete, stage) => {
      if (_complete === false) return detail;
      progress(100); stage?.('verifying'); await new Promise<void>(done => { finishUpload = done; }); return detail;
    });
    mocks.create.mockResolvedValue({ ...detail, discussion: { id: 'server', status: 'recording' } });
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    await click(copy.stop);
    expect(container.textContent).not.toContain('Recording saved on this device. You can leave this page.');
    await act(async () => { finishStop(); });
    expect(container.textContent).toContain('Recording saved on this device. You can leave this page.');
    expect(container.textContent).toContain('Confirming uploaded audio');
    expect(container.textContent).not.toContain('Original audio synced. You can leave this page.');
    expect(container.textContent).toContain('View later');
    await act(async () => { finishUpload(); });
    expect(mocks.recorder.discard).toHaveBeenCalledWith('local');
  });

  it('never shows full local success when stop or storage finalization fails', async () => {
    mocks.recorder.stop = vi.fn(async () => { mocks.recorder.phase = 'error'; throw new Error('Local commit failed'); });
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    await click(copy.stop);
    expect(container.textContent).not.toContain('Recording saved on this device. You can leave this page.');
    expect(container.textContent).toContain('Part of the recording was retained');
    expect(mocks.upload.mock.calls.filter(call => call[3] !== false)).toHaveLength(0);
  });
  it('starts locally with cached consent and retries a failed server creation using the original recording identity', async () => {
    mocks.create.mockRejectedValueOnce(new Error('OFFLINE')).mockResolvedValue(detail);
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.recorder.start).toHaveBeenCalledOnce();
    await click(copy.stop);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    for (const [input] of mocks.create.mock.calls) expect(input).toMatchObject({ clientRequestId: 'local', recordedAt: 42 });
    expect(mocks.recorder.discard).toHaveBeenCalledWith('local');
    expect(mocks.navigate).not.toHaveBeenCalled();
    await click(copy.openNote);
    expect(mocks.navigate).toHaveBeenCalledWith('/notes/note');
  });

  it('offers opening the same Note after the original is saved even when the live text queue is blocked', async () => {
    mocks.drain.mockReturnValue(new Promise(() => {}));
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    await click(copy.stop);
    expect(mocks.upload).toHaveBeenCalled(); expect(mocks.recorder.discard).toHaveBeenCalledWith('local');
    expect(mocks.navigate).not.toHaveBeenCalled();
    await click(copy.openNote);
    expect(mocks.navigate).toHaveBeenCalledWith('/notes/note');
  });

  it('does not start a concurrent automatic finish when restoring an interrupted recording', async () => {
    mocks.recorder.phase = 'error';
    await click(copy.recover);
    expect(mocks.recorder.restore).toHaveBeenCalledOnce();
    expect(mocks.recorder.stop).not.toHaveBeenCalled();
    expect(mocks.recorder.discard).toHaveBeenCalledOnce();
  });
  it('retains local audio and highlights without misreporting an annotation outage as an audio failure', async () => {
    mocks.annotations.mockRejectedValue(new Error('Annotation offline'));
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    await click(copy.stop);
    expect(mocks.recorder.discard).not.toHaveBeenCalled();
    expect(mocks.recorder.markUploadFailed).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Original audio synced. You can leave this page.');
    expect(container.textContent).toContain('Retry highlights');
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it('allows dismissal after the local barrier while sync continues, without showing another blocking panel', async () => {
    mocks.upload.mockImplementation(async (_draft, _id, _progress, complete) => complete === false ? detail : await new Promise(() => {}));
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    await click(copy.stop);
    await click('View later');
    expect(container.querySelector('[data-recording-outcome]')).toBeNull();
    expect(mocks.recorder.discard).not.toHaveBeenCalled();
  });

  it('never labels an empty recording as a retained partial source', async () => {
    mocks.create.mockResolvedValue({ ...detail,discussion: { id: 'server',status: 'recording' } });
    mocks.recorder.draft = { ...draft,chunkCount: 0,saveOutcome: 'incomplete' };
    mocks.recorder.stop = vi.fn(async () => { mocks.recorder.phase = 'error'; throw new Error('No audio'); });
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    await click(copy.stop);
    expect(container.textContent).toContain('Recording could not be saved');
    expect(container.textContent).not.toContain('Part of the recording was retained');
    expect(container.textContent).not.toContain('You can leave this page');
  });
  it('retries highlights independently and removes the local source only after confirmed sync', async () => {
    mocks.annotations.mockRejectedValueOnce(new Error('Annotation offline')).mockResolvedValue(undefined);
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    await click(copy.stop);
    const uploads = mocks.upload.mock.calls.length;
    await click('Retry highlights');
    expect(mocks.upload).toHaveBeenCalledTimes(uploads);
    expect(mocks.create).toHaveBeenCalledOnce();expect(mocks.recorder.discard).toHaveBeenCalledWith('local');
    expect(container.textContent).not.toContain('Retry highlights');
  });

  it('preserves same-Note continuation after an interruption in the completion surface', async () => {
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    mocks.recorder.phase = 'error';mocks.recorder.draft = { ...draft,saveOutcome: 'interrupted',serverDiscussionId: 'server' };
    mocks.get.mockResolvedValue({ ...detail,discussion: { id: 'server',status: 'recording' } });
    await act(async () => root.render(<GlobalDiscussionCaptureHost />));
    await click('Continue recording');
    expect(mocks.recorder.start).toHaveBeenLastCalledWith(expect.objectContaining({ continuation: expect.objectContaining({ id: 'local',serverDiscussionId: 'server' }) }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('shows preparation rather than stopped/saved status and gates duplicate start requests', async () => {
    localStorage.clear();let finishSettings!: (value: unknown) => void;
    mocks.settings.mockReturnValue(new Promise(resolve => { finishSettings = resolve; }));
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT));window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    expect(mocks.settings).toHaveBeenCalledTimes(1);expect(mocks.recorder.start).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Preparing to record');expect(container.textContent).not.toContain(copy.status.stopped);
    await act(async () => { finishSettings({ consentPolicyVersion: 1,consentAcknowledgedAt: 1 }); });
    expect(mocks.recorder.start).toHaveBeenCalledTimes(1);expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('dismisses redundant saved feedback after opening the confirmed original in the same Note', async () => {
    await act(async () => window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)));
    await click(copy.stop);await click(copy.openNote);
    expect(mocks.navigate).toHaveBeenCalledWith('/notes/note');
    expect(container.querySelector('[data-recording-window]')).toBeNull();
  });

  it('uses the offline recording hint for expected network failures while keeping actual recorder failures visible', async () => {
    const online = vi.spyOn(navigator,'onLine','get').mockReturnValue(false);
    try {
      mocks.create.mockResolvedValue({ ...detail,discussion: { id: 'server',status: 'recording' } });
      mocks.upload.mockRejectedValue(new TypeError('Failed to fetch'));
      await act(async () => { window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
      expect(container.textContent).toContain('Recording offline');
      expect(container.querySelector('[role=alert]')).toBeNull();
      mocks.recorder.error = 'Local storage failed';
      await act(async () => root.render(<GlobalDiscussionCaptureHost />));
      expect(container.querySelector('[role=alert]')).not.toBeNull();
      expect(container.textContent).toContain('Local storage failed');
    } finally { online.mockRestore(); }
  });

});
