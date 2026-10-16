// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { DiscussionDetail } from '../discussion-types';
const mocks = vi.hoisted(() => ({ detail: undefined as DiscussionDetail | undefined, fetch: vi.fn() }));
vi.mock('swr', () => ({ default: (key: unknown) => ({ data: Array.isArray(key) ? mocks.detail : [],isLoading: false,mutate: async () => {} }) }));
vi.mock('@/lib/fetch', () => ({ fetchJson: (url: string,...args: unknown[]) => url.includes('/review?') ? Promise.resolve({ version: 'v',hits: [],chapters: [],coverage: { durationMs: 0,audioAvailable: true,processedMs: 0,continuousThroughMs: 0,analysisRanges: [],complete: true } }) : mocks.fetch(url,...args) }));
vi.mock('../discussion-api', () => ({ getDiscussionForNote: vi.fn(),retryDiscussion: vi.fn() }));
vi.mock('@/features/chat/context/page-context-capture-button', () => ({ PageContextCaptureButton: () => null }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (select: (state: { language: string }) => unknown) => select({ language: 'zh' }) }));
import { DiscussionNoteSections } from '../discussion-note-sections';
import { useDiscussionReviewState } from '../discussion-review-state';
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const evidence = { transcriptRevision: 7,stale: false,audioAvailable: true,timingVerified: true,segments: [
  { sequence: 0,startedAtMs: 0,endedAtMs: 1000,text: 'First source',playback: [{ startedAtMs: 0,endedAtMs: 1000 }] },
  { sequence: 70,startedAtMs: 70000,endedAtMs: 71000,text: 'Distant source',playback: [{ startedAtMs: 72000,endedAtMs: 73000 }] },
] };
beforeEach(() => {
  Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); localStorage.clear(); useDiscussionReviewState.setState({ notes: {} });
  mocks.detail = { note: { id: 'note',title: 'Title',attachments: [],markdown: '' },discussion: { id: 'capture',noteId: 'note',clientRequestId: 'recording',audioAttachmentId: 'audio',audioSha256: 'source',durationMs: 100000,transcriptRevision: 7,status: 'completed' },
    transcript: { revision: 7,text: 'Text',segments: Array.from({ length: 100 },(_,sequence) => ({ sequence,status: 'confirmed',startedAtMs: sequence * 1000,endedAtMs: (sequence + 1) * 1000,displayText: `Current segment ${sequence}` })) },
    organization: { revision: 1,transcriptRevision: 7,organization: { title: 'Title',summary: 'Summary',keyPoints: [],decisions: [{ id: 'decision',text: 'Conclusion',evidenceSegmentIds: [0,70] }],actionItems: [],risks: [],openQuestions: [],chapters: [] } },
  } as unknown as DiscussionDetail;
  mocks.fetch.mockResolvedValue(evidence);
  vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue(undefined); vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(() => {});
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = async () => { await act(async () => root.render(<MemoryRouter><DiscussionNoteSections noteId="note" /></MemoryRouter>)); };
const button = (text: string) => [...container.querySelectorAll('button')].find(button => button.textContent === text)!;
it('opens separately versioned evidence ranges and pauses at the selected source boundary', async () => {
  await render(); const player = container.querySelector('audio')!; Object.defineProperty(player,'readyState',{ value: 1 });
  await act(async () => button('原话').click());
  expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining('/evidence?revision=7&segments=0,70'));
  const sidebar = container.querySelector('[aria-label="原话证据"]')!;
  expect(sidebar.textContent).toContain('First source'); expect(sidebar.textContent).toContain('Distant source');
  expect([...sidebar.querySelectorAll('button')].filter(button => button.textContent?.startsWith('播放原话'))).toHaveLength(2);
  await act(async () => [...sidebar.querySelectorAll('button')].find(button => button.textContent?.startsWith('播放原话'))!.click());
  expect(player.currentTime).toBe(0);
  await act(async () => { player.currentTime = 1.1; player.dispatchEvent(new Event('timeupdate')); });
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});
it('locates evidence beyond the first transcript page and keeps the same audio element across tabs', async () => {
  await render(); const player = container.querySelector('audio');
  await act(async () => button('原话').click());
  await act(async () => [...container.querySelectorAll('button')].filter(button => button.textContent === '定位原文')[1].click());
  expect(container.querySelector('#discussion-segment-70')).not.toBeNull(); expect(container.querySelector('audio')).toBe(player);
  await act(async () => button('概览').click()); expect(container.querySelector('audio')).toBe(player);
});
it('keeps corrected historical evidence readable without binding old segment IDs to new transcript rows', async () => {
  mocks.fetch.mockResolvedValue({ ...evidence,stale: true,transcriptRevision: 3 }); await render();
  await act(async () => button('原话').click());
  expect(container.textContent).toContain('原文已更新'); expect(container.textContent).toContain('First source');
  expect(button('定位原文')).toBeUndefined();
});
it('restores playback position without autoplay and removes playback when source audio is deleted', async () => {
  useDiscussionReviewState.getState().update('note',{ positionMs: 4000,source: 'source' });
  await render(); const player = container.querySelector('audio')!;
  await act(async () => player.dispatchEvent(new Event('loadedmetadata')));
  expect(player.currentTime).toBe(4); expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  await act(async () => button('原话').click());
  mocks.detail!.discussion.audioDeletedAt = 1; await render();
  expect(container.querySelector('audio')).toBeNull();
  expect([...container.querySelectorAll('button')].filter(button => button.textContent?.startsWith('播放原话'))).toHaveLength(0);
  expect(container.textContent).toContain('First source');
});
