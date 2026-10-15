// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const recorder: Record<string, unknown> = {};
  return { recorder, create: vi.fn(), settings: vi.fn(), get: vi.fn(),
    upload: vi.fn(), navigate: vi.fn(), drain: vi.fn() };
});
vi.mock('../use-discussion-recorder', () => ({ useDiscussionRecorder: () => mocks.recorder }));
vi.mock('../discussion-api', () => ({
  createDiscussion: mocks.create, getDiscussionCaptureSettings: mocks.settings, getDiscussion: mocks.get,
  getDiscussionTranscript: vi.fn(async () => ({ text: '' })),
  acknowledgeDiscussionConsent: vi.fn(), cancelDiscussion: vi.fn(), unlinkDiscussionProject: vi.fn(), uploadDiscussionSegment: vi.fn(),
}));
vi.mock('../recording-upload', () => ({ uploadDraftRecording: mocks.upload }));
vi.mock('../discussion-draft-store', () => ({
  deleteDiscussionLiveSegment: vi.fn(), listDiscussionLiveSegments: async () => [], saveDiscussionLiveSegment: vi.fn(),
}));
vi.mock('../discussion-segment-upload-queue', () => ({ drainDiscussionSegmentUploadQueue: mocks.drain }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
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
  mimeType: 'audio/webm', state: 'stopped', consentPolicyVersion: 1 };
const detail = { discussion: { id: 'server', status: 'stopping', audioAttachmentId: 'audio' }, note: { id: 'note', title: 'Note' } };
const copy = messages('en').notes.discussionCapture;
async function click(label: string) {
  await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === label)!.click(); });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); localStorage.clear();
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
  it('starts locally with cached consent and retries a failed server creation using the original recording identity', async () => {
    mocks.create.mockRejectedValueOnce(new Error('OFFLINE')).mockResolvedValue(detail);
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.recorder.start).toHaveBeenCalledOnce();
    await click(copy.stop);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    for (const [input] of mocks.create.mock.calls) expect(input).toMatchObject({ clientRequestId: 'local', recordedAt: 42 });
    expect(mocks.recorder.discard).toHaveBeenCalledWith('local');
    expect(mocks.navigate).toHaveBeenCalledWith('/notes/note');
  });

  it('finishes and navigates after the original is saved even when the live text queue is blocked', async () => {
    mocks.drain.mockReturnValue(new Promise(() => {}));
    await act(async () => { window.dispatchEvent(new Event(OPEN_DISCUSSION_CAPTURE_EVENT)); });
    await click(copy.stop);
    expect(mocks.upload).toHaveBeenCalled(); expect(mocks.recorder.discard).toHaveBeenCalledWith('local');
    expect(mocks.navigate).toHaveBeenCalledWith('/notes/note');
  });

  it('does not start a concurrent automatic finish when restoring an interrupted recording', async () => {
    mocks.recorder.phase = 'error';
    await click(copy.recover);
    expect(mocks.recorder.restore).toHaveBeenCalledOnce();
    expect(mocks.recorder.stop).not.toHaveBeenCalled();
    expect(mocks.recorder.discard).toHaveBeenCalledOnce();
  });
});
