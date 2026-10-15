// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiscussionDetail } from '../discussion-types';

const mocks = vi.hoisted(() => {
  const state: { detail?: DiscussionDetail } = {};
  return { state, retry: vi.fn(), mutate: vi.fn(async () => {}) };
});
vi.mock('swr', () => ({ default: (key: unknown) => ({ data: Array.isArray(key) ? mocks.state.detail : [], isLoading: false, mutate: mocks.mutate }) }));
vi.mock('../discussion-api', () => ({ getDiscussionForNote: vi.fn(), retryDiscussion: mocks.retry }));
vi.mock('@/features/chat/context/page-context-capture-button', () => ({ PageContextCaptureButton: () => null }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (select: (state: { language: string }) => unknown) => select({ language: 'zh' }) }));

import { DiscussionNoteSections } from '../discussion-note-sections';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks();
  mocks.retry.mockResolvedValue(undefined);
  mocks.state.detail = {
    note: { id: 'note', markdown: '', title: 'Meeting', attachments: [], kind: 'voice', status: 'inbox', createdAt: 1, updatedAt: 1, capturedVia: { channel: 'web' } },
    discussion: { id: 'capture', clientRequestId: 'request', noteId: 'note', source: 'web', recordingStartedAt: 1, createdAt: 1, updatedAt: 1, status: 'completed', audioAttachmentId: 'original', canonicalTranscript: 'Old transcript', transcriptRevision: 1, durationMs: 30_000 },
    transcript: { discussionId: 'capture', revision: 1, text: 'Old transcript', segments: [], stats: { uploaded: 0, transcribing: 0, confirmed: 0, failed: 0 } },
    organization: { id: 'organization', discussionId: 'capture', status: 'completed', inputTranscriptSha256: 'hash', promptVersion: 'v1', modelRef: 'test', createdAt: 1, revision: 1, transcriptRevision: 1, organization: { title: 'Meeting', summary: 'Previous published summary', keyPoints: [], decisions: [], actionItems: [], risks: [], openQuestions: [], chapters: [] } },
  };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async () => { await act(async () => { root.render(<MemoryRouter><DiscussionNoteSections noteId="note" /></MemoryRouter>); }); };
const find = (text: string) => [...container.querySelectorAll('button')].find(button => button.textContent === text);

describe('original-audio regeneration controls', () => {
  it('distinguishes a full original-audio rerun from summary-only regeneration', async () => {
    await render();
    expect(find('重新整理纪要')).toBeDefined();
    await act(async () => find('从原音重新生成')!.click());
    expect(mocks.retry).toHaveBeenCalledWith('capture', 'from_audio');
    expect(container.textContent).toContain('Previous published summary');
  });

  it('keeps previous results visible and explains persisted automatic retries while processing', async () => {
    mocks.state.detail!.discussion.status = 'sealing';
    mocks.state.detail!.processing = { fromAudio: true, completedChunks: 2, transcribedMs: 40_000, attemptCount: 1, maxAttempts: 3, nextAttemptAt: Date.now() + 5_000 };
    await render();
    expect(find('从原音重新生成')).toBeUndefined();
    expect(container.textContent).toContain('将自动重试');
    expect(container.textContent).toContain('Previous published summary');
  });

  it('does not offer original-audio regeneration after audio deletion', async () => {
    mocks.state.detail!.discussion.audioDeletedAt = Date.now();
    await render(); expect(find('从原音重新生成')).toBeUndefined();
  });
});
