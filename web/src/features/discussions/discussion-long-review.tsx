import type { DiscussionEvidence, DiscussionReview, DiscussionReviewEntry } from '@xopcai/gateway-contract';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}`;
export function DiscussionLongReview({ id, query, zh, refreshKey, sourceKey, active, tab, onEvidence, onPlay }: {
  id: string; query: string; zh: boolean; refreshKey: string; sourceKey?: string; active: boolean; tab: string;
  onEvidence: (evidence: DiscussionEvidence) => void; onPlay: (start: number,end: number) => void;
}) {
  const [review,setReview] = useState<DiscussionReview>();
  const [loading,setLoading] = useState(true); const [error,setError] = useState('');
  const [busy,setBusy] = useState(false); const generation = useRef(0);
  const [loadedSource,setLoadedSource] = useState<string>();
  const [selected,setSelected] = useState<DiscussionReviewEntry>();
  const [freshQuery,setFreshQuery] = useState('');
  const [tick,setTick] = useState(0);
  useEffect(() => { if (!active || query) return; const timer = window.setInterval(() => setTick(value => value + 1),3000); return () => window.clearInterval(timer); },[active,query]);
  useEffect(() => { setSelected(undefined); },[id,query]);
  useEffect(() => {
    const current = ++generation.current; const controller = new AbortController();
    setLoading(true); setBusy(false); setError('');
    const timer = window.setTimeout(() => {
      void fetchJson<DiscussionReview>(apiUrl(`/api/discussions/${encodeURIComponent(id)}/review?q=${encodeURIComponent(query)}`),{ signal: controller.signal }).then(value => {
        if (generation.current === current) { setReview(value); setLoadedSource(sourceKey); setFreshQuery(query); }
      }).catch(caught => { if (generation.current === current && !controller.signal.aborted) setError(String(caught)); })
        .finally(() => { if (generation.current === current) setLoading(false); });
    },query ? 200 : 0);
    return () => { generation.current++; controller.abort(); window.clearTimeout(timer); };
  },[id,query,refreshKey,sourceKey,tick]);
  async function more() {
    if (!review || busy) return; const current = generation.current; setBusy(true);
    try {
      const next = await fetchJson<DiscussionReview>(apiUrl(`/api/discussions/${encodeURIComponent(id)}/review?q=${encodeURIComponent(query)}&offset=${review.hits.length}&version=${review.version}`));
      if (current === generation.current) setReview({ ...next,hits: [...review.hits,...next.hits] });
    } catch (caught) { if (current === generation.current) setError(zh ? `内容已变化，请重新搜索。${String(caught)}` : `Content changed; search again. ${String(caught)}`); }
    finally { setBusy(false); }
  }
  function open(entry: DiscussionReviewEntry) {
    setSelected(entry);
    if ((!entry.provisional || entry.kind === 'chapter') && entry.transcriptRevision !== undefined && entry.segments.length) onEvidence({ transcriptRevision: entry.transcriptRevision,stale: entry.stale,audioAvailable: review?.coverage.audioAvailable ?? false,timingVerified: entry.segments.some(s => s.playback.length > 0),segments: entry.segments });
  }
  const label = (entry: DiscussionReviewEntry) => entry.kind === 'chapter' ? (zh ? '章节' : 'Chapter') : entry.kind === 'annotation' ? (zh ? '我的标记' : 'My mark') : entry.kind === 'analysis' ? (zh ? '分析' : 'Analysis') : (zh ? '原文' : 'Transcript');
  const row = (entry: DiscussionReviewEntry) => <article key={entry.id} className="space-y-2 rounded-xl bg-surface-inset p-4">
    <button className="text-left text-sm text-accent-fg" onClick={() => open(entry)}>{entry.startedAtMs !== undefined ? `${clock(entry.startedAtMs)}${entry.endedAtMs !== undefined ? `–${clock(entry.endedAtMs)}` : ''} · ` : ''}{entry.title || label(entry)}</button>
    <p className="whitespace-pre-wrap text-sm">{entry.kind === 'chapter' && !query && entry.text.length > 300 ? `${entry.text.slice(0,300)}…` : entry.text}</p>
    <p className="text-xs text-fg-muted">{label(entry)}{entry.provisional ? (zh ? ' · 阶段性结果' : ' · Partial result') : ''}{entry.stale ? (zh ? ' · 原文已更新，保留旧版依据' : ' · Earlier transcript revision') : ''}{entry.kind === 'chapter' ? ` · ${entry.highlightCount ?? 0} ${zh ? '个重点' : 'marks'} · ${entry.actionCount ?? 0} ${zh ? '个候选行动' : 'candidate actions'}` : ''}</p>
    {(entry.kind !== 'chapter' || query || selected?.id === entry.id) ? entry.segments.map(s => <p key={`${s.sequence}:${s.startedAtMs}`} className="text-xs text-fg-muted">{clock(s.startedAtMs)} · {s.text.length > 500 ? `${s.text.slice(0,500)}…` : s.text}</p>) : null}
    {entry.playback.slice(0,3).map((range,index) => <Button key={index} onClick={() => onPlay(range.startedAtMs,range.endedAtMs)}>{zh ? '回听上下文' : 'Play context'} {clock(range.startedAtMs)}–{clock(range.endedAtMs)}</Button>)}
    {entry.segments.length ? <Button onClick={() => open(entry)}>{zh ? '查看对应原文' : 'View transcript'}</Button> : <p className="text-xs text-fg-muted">{zh ? '暂无可核实的原文定位' : 'No verified transcript reference'}</p>}
  </article>;
  return <section aria-label={zh ? '长录音回顾' : 'Recording review'} className="flex flex-col gap-3">
    {error ? <div><p role="alert" className="text-sm text-danger">{error}</p><Button onClick={() => setTick(value => value + 1)}>{zh ? '刷新结果' : 'Refresh results'}</Button></div> : null}
    {loading && (!review || loadedSource !== sourceKey || freshQuery !== query) ? <Skeleton className="h-20 w-full" /> : null}
    {review && loadedSource === sourceKey && (!query || freshQuery === query) ? <>

      {query ? <><h3 className="text-sm font-medium">{zh ? `搜索结果 · ${review.total}` : `Search results · ${review.total}`}</h3><Button onClick={() => setTick(value => value + 1)}>{zh ? '刷新结果' : 'Refresh results'}</Button>
        <div aria-label={zh ? '命中位置' : 'Match positions'} className="relative my-3 h-5 rounded bg-surface-inset">{review.hits.filter(hit => hit.startedAtMs !== undefined).map(hit => <button key={hit.id} className="absolute top-0 h-5 w-1.5 rounded bg-accent" style={{ left: `${Math.min(99,100 * hit.startedAtMs! / Math.max(1,review.coverage.durationMs))}%` }} aria-label={`${clock(hit.startedAtMs!)} ${hit.title || label(hit)}`} onClick={() => open(hit)} />)}</div>{!review.total ? <p className="text-sm text-fg-muted">{zh ? '未找到关键词；尚未转写的内容无法搜索。' : 'No matches. Untranscribed audio is not searchable yet.'}</p> : null}{review.hits.map(row)}</> : <>
        {tab === 'summary' && review.chapters.length ? <details className="rounded-xl bg-surface-inset px-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-accent">{zh ? '章节目录' : 'Chapters'} · {review.chapters.length}</summary><div className="space-y-3 pb-4">{review.chapters.map(row)}</div></details> : null}
        {review.hits.length ? <><h3 className="text-sm font-medium">{zh ? '本轮已完成转写（阶段性）' : 'Available transcription from this run'}</h3>{review.hits.map(row)}</> : null}
      </>}
      {review.hasMore ? <Button disabled={busy} onClick={() => void more()}>{zh ? '加载更多结果' : 'More results'}</Button> : null}
      <details className="rounded-lg text-xs text-fg-muted"><summary className="min-h-11 cursor-pointer py-3 focus-visible:ring-2 focus-visible:ring-accent">{zh ? '处理范围' : 'Processing coverage'}</summary><div role="status" className="space-y-2 pb-3 leading-5">
        <p>{zh ? '原音' : 'Audio'} · {review.coverage.audioAvailable ? (zh ? '已保存，可回听' : 'Saved, ready to play') : (zh ? '尚不可用' : 'Unavailable')}</p>
        <p>{zh ? '本轮转写已处理' : 'Processed this run'} {clock(review.coverage.processedMs)} / {clock(review.coverage.durationMs)} · {zh ? '连续处理至' : 'Continuous through'} {clock(review.coverage.continuousThroughMs)}</p>
        <p>{zh ? '分析覆盖' : 'Analysis coverage'} · {review.coverage.analysisRanges.length ? review.coverage.analysisRanges.map(r => `${clock(r.startedAtMs)}–${clock(r.endedAtMs)}`).join('、') : (zh ? '暂无本版已完成章节' : 'No completed chapters for this revision')}{review.coverage.analysisStale ? (zh ? '；已发布分析基于旧版原文' : '; published analysis uses an earlier transcript') : ''} · {review.coverage.complete ? (zh ? '本轮处理完成' : 'Run complete') : (zh ? '阶段性内容，其余仍待处理' : 'Partial content; remaining work pending')}</p>
      </div></details>
      {selected?.provisional ? <p className="text-xs text-fg-muted">{zh ? '以上是本轮已保存的阶段性原文；正式发布后才能校对和标记具体段落。' : 'Saved partial text; segment editing and highlighting become available after publication.'}</p> : null}
    </> : null}
  </section>;
}
