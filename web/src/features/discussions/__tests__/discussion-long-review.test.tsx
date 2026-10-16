// @vitest-environment jsdom
import type { DiscussionReview, DiscussionReviewEntry } from '@xopcai/gateway-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.fetch }));
import { DiscussionLongReview } from '../discussion-long-review';
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const evidence = vi.fn(); const play = vi.fn();
const entry: DiscussionReviewEntry = { id: 'tail',kind: 'transcript',title: 'Speaker',text: 'The tail keyword',transcriptRevision: 8,provisional: false,stale: false,startedAtMs: 7190000,endedAtMs: 7195000,segments: [{ sequence: 1199,startedAtMs: 7190000,endedAtMs: 7195000,text: 'Exact text with context',playback: [{ startedAtMs: 7200000,endedAtMs: 7205000 }] }],playback: [{ startedAtMs: 7198000,endedAtMs: 7208000 }] };
const response = (overrides: Partial<DiscussionReview> = {}): DiscussionReview => ({ version: 'v1',query: 'keyword',offset: 0,total: 1,hasMore: false,hits: [entry],chapters: [],coverage: { durationMs: 7200000,audioAvailable: true,transcriptRanges: [],processedRanges: [{ startedAtMs: 0,endedAtMs: 60000 },{ startedAtMs: 90000,endedAtMs: 120000 }],processedMs: 90000,continuousThroughMs: 60000,analysisRanges: [{ startedAtMs: 0,endedAtMs: 30000 }],analysisStale: true,complete: false },...overrides });
beforeEach(() => { Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers(); vi.resetAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
const render = async (id = 'note',query = 'keyword',active = false) => { await act(async () => root.render(<DiscussionLongReview id={id} query={query} active={active} tab="summary" zh refreshKey="v1" onEvidence={evidence} onPlay={play} />)); await act(async () => vi.advanceTimersByTimeAsync(210)); };
const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.startsWith(label))!;
it('searches the Note once, opens versioned text, shows coverage gaps and plays mapped context', async () => {
  mocks.fetch.mockResolvedValue(response()); await render();
  expect(mocks.fetch.mock.calls[0][0]).toContain('/review?q=keyword');
  expect(container.textContent).toContain('1:30 / 120:00'); expect(container.textContent).toMatch(/连续处理至\s*1:00/); expect(container.textContent).toContain('已发布分析基于旧版原文');
  await act(async () => button('查看对应原文').click());
  expect(evidence).toHaveBeenCalledWith(expect.objectContaining({ transcriptRevision: 8,segments: [entry.segments[0]] }));
  await act(async () => button('回听上下文').click()); expect(play).toHaveBeenCalledWith(7198000,7208000);
  expect(container.querySelector('[aria-label="命中位置"] button')).not.toBeNull();
});
it('shows partial chapters and checkpoint text before the overview completes without inventing current evidence IDs', async () => {
  mocks.fetch.mockResolvedValue(response({ query: '',chapters: [{ ...entry,id: 'chapter',kind: 'chapter',provisional: true,title: 'Completed chapter' }],hits: [{ ...entry,id: 'checkpoint:run',provisional: true,transcriptRevision: undefined }] }));
  await render('note',''); expect(container.textContent).toContain('Completed chapter'); expect(container.textContent).toContain('阶段性结果');
  await act(async () => [...container.querySelectorAll('button')].filter(b => b.textContent === '查看对应原文')[1].click());
  expect(evidence).not.toHaveBeenCalled(); expect(container.textContent).toContain('正式发布后才能校对');
});
it('fences old Note and old query responses and restarts pagination against the same version', async () => {
  let resolve!: (value: DiscussionReview) => void;
  mocks.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(response({ hasMore: true,total: 2 }));
  await render('old'); await render('new','newword');
  await act(async () => resolve(response({ hits: [{ ...entry,text: 'Late old Note' }] })));
  expect(container.textContent).not.toContain('Late old Note');
  mocks.fetch.mockResolvedValue(response({ hits: [{ ...entry,id: 'second' }],offset: 1 }));
  await act(async () => button('加载更多结果').click());
  expect(mocks.fetch.mock.calls.at(-1)![0]).toContain('offset=1&version=v1');
});
it('refreshes partial processing without needing the whole document to change', async () => {
  mocks.fetch.mockResolvedValue(response({ query: '' })); await render('note','',true);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(3000)); await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
