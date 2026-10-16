import { DiscussionTools, type DiscussionNoteManagementActions } from './discussion-tools';
import { RecordingOutcomeCard, recordingOutcomeInput } from './recording-outcome-card';
import { DiscussionLongReview } from './discussion-long-review';
import type { DiscussionEvidence } from '@xopcai/gateway-contract';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Play, Search, SquarePen, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { taskDetailHref } from '@/features/tasks/task-detail-route';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

import { DiscussionAnnotations } from './discussion-annotations';
import { newAnnotation, saveLocalAnnotation } from './discussion-annotation-store';
import { syncDiscussionAnnotations } from './discussion-annotation-sync';
import { readReviewState, useDiscussionReviewState } from './discussion-review-state';
import { MeetingEditDialog, type MeetingEditDraft } from './meeting-edit-dialog';
import { discussionPageText } from './discussion-page-context';
import { getDiscussionForNote, retryDiscussion } from './discussion-api';
import type { DiscussionFact, DiscussionTranscript, DiscussionTranscriptSegment, DiscussionTemplate } from './discussion-types';

const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
type ActionTask = { actionId: string; taskId: string; phase?: string; resolution?: string; deleted: boolean };

export function DiscussionNoteSections({ noteId, onPersonalNotes, noteActions }: { noteId: string; onPersonalNotes?: () => void; noteActions?: DiscussionNoteManagementActions }) {
  const location = useLocation();
  const zh = useLocaleStore(state => state.language) === 'zh';
  const { data: detail, mutate, isLoading } = useSWR(['note-discussion-document', noteId], () => getDiscussionForNote(noteId), { refreshInterval: data => data && (['recording', 'stopping', 'sealing', 'organizing'].includes(data.discussion.status) || data.recordingJob?.state === 'queued' || data.recordingJob?.state === 'running') ? 3_000 : 0 });
  const id = detail?.discussion.id;
  const base = `/api/discussions/${encodeURIComponent(id ?? '')}`;
  const { data: tasks = [], mutate: refreshTasks } = useSWR<ActionTask[]>(id ? `${base}/actions` : null, path => fetchJson(apiUrl(path)), { refreshInterval: 10_000 });
  const review = useDiscussionReviewState(state => readReviewState(noteId,state.notes[noteId]));
  const updateReview = useDiscussionReviewState(state => state.update);
  const tab = review.tab; const setTab = (tab: typeof review.tab) => updateReview(noteId,{ tab });
  const query = review.query; const setQuery = (query: string) => updateReview(noteId,{ query });
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); },[searchOpen]);
  const [template, setTemplate] = useState<DiscussionTemplate>('general');
  const [evidence, setEvidence] = useState<DiscussionEvidence | null>(null);
  const [editing, setEditing] = useState<{ segment: DiscussionTranscriptSegment; text: string; speaker: string; applyToSpeakerGroup?: boolean } | null>(null);
  const [edit, setEdit] = useState<MeetingEditDraft | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const page = review.page; const setPage = (page: number) => updateReview(noteId,{ page });
  const rangeEnd = useRef<number | null>(null);
  const [focused, setFocused] = useState<number[]>([]);
  const sourceGeneration = useRef(0);
  const evidenceRequest = useRef(0);
  const currentTranscriptRevision = useRef(detail?.transcript.revision); currentTranscriptRevision.current = detail?.transcript.revision;
  const audio = useRef<HTMLAudioElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [, setPlayingAt] = useState(0);

  useEffect(() => {
    const refresh = () => { void mutate(); void refreshTasks(); };
    window.addEventListener('discussion-updated', refresh);
    window.addEventListener('discussion-segment-updated', refresh);
    return () => { window.removeEventListener('discussion-updated', refresh); window.removeEventListener('discussion-segment-updated', refresh); };
  }, [mutate, refreshTasks]);
  useEffect(() => { if (detail?.discussion.template) setTemplate(detail.discussion.template); }, [detail?.discussion.template]);

  async function operation(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); await mutate(); await refreshTasks(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }
  function seek(ms: number,endMs?: number) {
    if (!audio.current) return;
    rangeEnd.current = endMs ?? null;
    if (audio.current.readyState === 0) { pendingSeek.current = ms / 1000; audio.current.load(); }
    else { audio.current.currentTime = ms / 1000; void audio.current.play().catch(() => undefined); }
  }
  function showEvidence(value: DiscussionEvidence) {
    const stale = value.stale || value.transcriptRevision !== currentTranscriptRevision.current;
    setEvidence({ ...value,stale }); if (!stale) setFocused(value.segments.map(segment => segment.sequence));
  }
  async function cite(refs: number[], revision?: number,play = false) {
    if (!detail) return;
    const generation = sourceGeneration.current; const request = ++evidenceRequest.current;
    await operation(async () => {
      const result = await fetchJson<DiscussionEvidence>(apiUrl(`${base}/evidence?revision=${revision ?? detail.organization?.transcriptRevision ?? detail.transcript.revision}&segments=${refs.join(',')}`));
      if (generation !== sourceGeneration.current || request !== evidenceRequest.current) return;
      showEvidence(result);
      if (play && result.segments[0]?.playback[0]) { const range = result.segments[0].playback[0]; seek(range.startedAtMs,range.endedAtMs); }
    });
  }
  async function markSegment(segment: DiscussionTranscriptSegment) {
    if (!detail) return;
    await operation(async () => {
      await saveLocalAnnotation(detail.discussion.clientRequestId,newAnnotation({ type: 'transcript',capturedAt: Date.now(),transcriptRevision: detail.transcript.revision,segmentIds: [segment.sequence] }));
      setTab('marks');
      void syncDiscussionAnnotations(detail.discussion.clientRequestId,detail.discussion.id).catch(error => setError(String(error)));
    });
  }
  useEffect(() => {
    sourceGeneration.current++; setEvidence(null); setFocused([]); setEditing(null); setEdit(null); setSelected([]); setError(null); rangeEnd.current = null;
    return () => { sourceGeneration.current++; };
  },[noteId]);
  useEffect(() => {
    const source = detail?.discussion.audioSha256 ?? detail?.discussion.audioAttachmentId;
    if (!source) return;
    const saved = readReviewState(noteId,useDiscussionReviewState.getState().notes[noteId]);
    if (saved.source && saved.source !== source) { sourceGeneration.current++; setEvidence(null); setFocused([]); audio.current?.pause(); updateReview(noteId,{ positionMs: 0,source }); pendingSeek.current = 0; rangeEnd.current = null; }
    else updateReview(noteId,{ source });
  },[noteId,detail?.discussion.audioSha256,detail?.discussion.audioAttachmentId,updateReview]);
  useEffect(() => {
    if (detail?.discussion.audioDeletedAt) { audio.current?.pause(); pendingSeek.current = null; rangeEnd.current = null;
      setEvidence(previous => previous ? { ...previous,audioAvailable: false,timingVerified: false,segments: previous.segments.map(segment => ({ ...segment,playback: [] })) } : null); }
  },[detail?.discussion.audioDeletedAt]);
  useEffect(() => {
    if (review.tab === 'transcript' && review.anchor !== undefined && review.anchorRevision === detail?.transcript.revision) window.setTimeout(() => document.getElementById(`discussion-segment-${review.anchor}`)?.scrollIntoView?.({ block: 'center' }),0);
  },[review.tab,review.anchor,review.anchorRevision,detail?.transcript.revision]);
  useEffect(() => {
    setFocused([]);
    setEvidence(previous => previous && previous.transcriptRevision !== detail?.transcript.revision ? { ...previous,stale: true } : previous);
  },[detail?.transcript.revision]);
  const facts = (title: string, items: DiscussionFact[], kind: 'decisions' | 'risks' | 'openQuestions') => items.some(item => showIgnored || !item.ignored) ? <section className="space-y-2"><h3 className="font-semibold text-fg">{title}</h3>{items.filter(item => showIgnored || !item.ignored).map(item => <div key={item.id} className="flex items-start gap-3 text-sm"><p className="flex-1 whitespace-pre-wrap">{item.text}{item.supersededBy || item.disputedBy ? <span className="ml-2 text-xs text-fg-muted">{zh ? '有后续变更' : 'Later changes'}</span> : null}{item.editedByUser ? <span className="ml-2 text-xs text-fg-muted">{zh ? (item.ignored ? '已忽略' : '人工编辑') : (item.ignored ? 'Ignored' : 'Edited')}</span> : null}</p><button className="text-xs text-fg-muted" disabled={busy} onClick={() => setEdit({ kind, itemId: item.id, text: item.text, ignored: item.ignored })}>{zh ? '编辑' : 'Edit'}</button>{item.evidenceSegmentIds.length ? <button disabled={busy} className="shrink-0 text-accent-fg" onClick={() => void cite(item.evidenceSegmentIds, item.evidenceRevision)}>{zh ? '原话' : 'Source'}</button> : <span className="text-xs text-fg-muted">{zh ? '暂无定位' : 'No source timing'}</span>}</div>)}</section> : null;

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!detail) return null;
  const { discussion, transcript, organization: record } = detail;
  const organization = record?.organization;
  const processing = ['stopping', 'sealing', 'organizing'].includes(discussion.status);
  const editable = ['recording', 'completed', 'needs_attention'].includes(discussion.status);
  const filtered = transcript.segments.filter(segment => (segment.displayText ?? segment.rawText ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase()) || segment.speakerLabel?.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pageText = tab === 'marks' || query.trim() ? '' : discussionPageText(detail, tab, { query, page, showIgnored });
  return <section className="relative flex h-full min-h-0 w-full flex-col text-fg" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'f') { event.preventDefault(); setSearchOpen(true); }
  }}>
    <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-5 sm:px-7">
      <div className="min-w-0 flex-1"><h2 className="text-xl font-semibold leading-snug tracking-tight">{!detail.note.title || /^Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(detail.note.title) ? (zh ? '语音笔记' : 'Voice note') : detail.note.title}</h2><p className="mt-1 text-xs text-fg-muted">{zh ? '录音' : 'Recording'} · {clock(discussion.durationMs ?? 0)}</p></div>
      <button type="button" aria-label={zh ? '搜索此 Note' : 'Search this Note'} aria-expanded={searchOpen || !!query} onClick={() => { setSearchOpen(open => !open); if (searchOpen) setQuery(''); }} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><Search className="size-5" aria-hidden /></button>
      <DiscussionTools noteActions={noteActions} detail={detail} template={template} onTemplate={setTemplate} zh={zh} busy={busy} processing={processing} pageText={pageText} editing={!!edit || !!editing} onPersonalNotes={onPersonalNotes}
        onOrganize={() => void operation(() => fetchJson(apiUrl(`${base}/organize`),{ method: 'POST',body: JSON.stringify({ template }) }))}
        onRegenerate={() => void operation(() => retryDiscussion(discussion.id,'from_audio'))} />
    </header>
    <nav aria-label={zh ? '笔记内容' : 'Note content'} className="mx-5 mb-2 flex shrink-0 gap-1 rounded-xl bg-surface-inset p-1 sm:mx-7">
      {(['summary','transcript','marks'] as const).map(value => <button key={value} aria-pressed={tab === value} className={`min-h-11 min-w-0 flex-1 rounded-lg px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${tab === value ? 'bg-surface-panel font-medium text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`} onClick={() => setTab(value)}>{value === 'summary' ? (zh ? '概览' : 'Overview') : value === 'marks' ? (zh ? '标记' : 'Highlights') : (zh ? '原文' : 'Transcript')}</button>)}
    </nav>
    {error ? <details role="alert" className="px-4 py-2 text-sm text-danger"><summary>{zh ? '操作未完成，可以稍后重试' : 'Action incomplete. Try again later'}</summary><p className="mt-2 break-words text-xs text-fg-muted">{error}</p></details> : null}

    {searchOpen || query ? <label className="mx-5 mb-2 flex shrink-0 items-center gap-2 rounded-xl bg-surface-inset px-3 sm:mx-7"><Search className="size-4 text-fg-muted" /><input ref={searchInput} aria-label={zh ? '搜索此 Note' : 'Search this Note'} className="min-h-11 min-w-0 w-full bg-transparent text-sm outline-none" maxLength={200} placeholder={zh ? '搜索这篇笔记' : 'Search this note'} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /><button className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? '关闭搜索' : 'Close search'} onClick={() => { setQuery(''); setSearchOpen(false); }}><X className="size-4" /></button></label> : null}
    <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-6 pt-1 sm:px-7">
      {discussion.status !== 'recording' || detail.recordingJob ? <RecordingOutcomeCard context="note" input={recordingOutcomeInput(detail)} zh={zh} busy={busy} onRetry={mode => void operation(() => mode === 'analyze' ? fetchJson(apiUrl(`${base}/organize`), { method: 'POST', body: JSON.stringify({ template }) }) : retryDiscussion(discussion.id, mode === 'regenerate' ? 'from_audio' : 'resume'))} /> : null}
      <div hidden={!!query.trim()}>
      {tab === 'marks' ? <DiscussionAnnotations key={discussion.id} recordingId={discussion.clientRequestId} discussionId={discussion.id} zh={zh} onEvidence={showEvidence} onPlay={range => seek(range.startedAtMs,range.endedAtMs)} /> : tab === 'summary' ? organization ? <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-3"><h3 className="text-base font-medium">{zh ? '摘要' : 'Summary'}</h3><button className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? '编辑概要' : 'Edit overview'} title={zh ? '编辑概要' : 'Edit overview'} disabled={busy || processing} onClick={() => setEdit({ kind: 'summary', itemId: 'summary', text: organization.summary })}><SquarePen className="size-4" aria-hidden /></button></div>
        <p className="whitespace-pre-wrap text-[15px] leading-7">{organization.summary}</p>{organization.summaryEditedByUser ? <p className="text-xs text-fg-muted">{zh ? '已由你编辑' : 'Edited by you'}</p> : null}
        {organization.summaryEvidenceSegmentIds?.length ? Array.from({ length: Math.ceil(organization.summaryEvidenceSegmentIds.length / 100) },(_,index) => <Button key={index} onClick={() => void cite(organization.summaryEvidenceSegmentIds!.slice(index * 100,(index + 1) * 100))}>{zh ? '查看原话' : 'View source'}{organization.summaryEvidenceSegmentIds!.length > 100 ? ` · ${index + 1}` : ''}</Button>) : null}
        {organization.keyPointEvidence?.length ? <section className="space-y-2"><h3>{zh ? '重点结论' : 'Key points'}</h3>{organization.keyPointEvidence.map(point => <div key={point.id} className="flex gap-2 text-sm"><p className="flex-1">{point.text}</p><Button onClick={() => void cite(point.evidenceSegmentIds,point.evidenceRevision)}>{zh ? '原话' : 'Source'}</Button></div>)}</section> : organization.keyPoints.length ? <section className="space-y-3"><h3 className="text-base font-medium">{zh ? '重点结论' : 'Key points'}</h3><ul className="list-disc space-y-2 pl-5 text-[15px] leading-7">{organization.keyPoints.map((point,index) => <li key={`${index}:${point}`}>{point}</li>)}</ul></section> : null}
        {[...organization.decisions,...organization.actionItems,...organization.risks,...organization.openQuestions].some(item => item.ignored) ? <label className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" className="ui-checkbox" checked={showIgnored} onChange={event => setShowIgnored(event.target.checked)} />{zh ? '显示已忽略项' : 'Show ignored items'}</label> : null}
        {selected.length ? <Button disabled={busy} onClick={() => void operation(async () => {
          for (const actionId of selected) await fetchJson(apiUrl(`${base}/actions/${encodeURIComponent(actionId)}/convert`), { method: 'POST', body: JSON.stringify({ organizationRevision: record.revision }) });
          setSelected([]);
        })}>{zh ? `加入所选 ${selected.length} 项任务` : `Add ${selected.length} selected tasks`}</Button> : null}
        {facts(zh ? '已决定事项' : 'Decisions', organization.decisions, 'decisions')}
        {organization.actionItems.length ? <section className="space-y-3"><h3 className="font-semibold">{zh ? '下一步行动' : 'Next actions'}</h3>{organization.actionItems.filter(item => showIgnored || !item.ignored).map(item => {
          const task = tasks.find(candidate => candidate.actionId === item.id);
          return <article key={item.id} className="rounded-lg border border-edge-subtle p-3"><div className="flex items-start gap-2">{!task && !item.ignored && (!(item.supersededBy || item.disputedBy) || item.reviewedChangeId === (item.supersededBy ?? item.disputedBy)) ? <input type="checkbox" aria-label={`${zh ? '选择行动' : 'Select action'}: ${item.title}`} className="ui-checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} /> : null}<p className="flex-1 text-sm font-medium">{item.title}{item.supersededBy || item.disputedBy ? <span className="ml-2 text-xs text-fg-muted">{zh ? '有后续变更，请复核' : 'Review later changes'}</span> : null}{item.editedByUser ? <span className="ml-2 text-xs text-fg-muted">{zh ? (item.ignored ? '已忽略' : '人工编辑') : (item.ignored ? 'Ignored' : 'Edited')}</span> : null}</p><button className="text-xs text-fg-muted" disabled={busy || processing} onClick={() => setEdit({ kind: 'actionItems', itemId: item.id, text: item.title, owner: item.owner, dueDate: item.dueDate, ignored: item.ignored })}>{zh ? '编辑' : 'Edit'}</button></div><p className="mt-1 text-xs text-fg-muted">{item.owner ?? (zh ? '负责人未明确' : 'Owner unspecified')} · {item.dueDate ?? (zh ? '期限未明确' : 'Date unspecified')}</p><div className="mt-3 flex flex-wrap items-center gap-3 text-xs">{item.evidenceSegmentIds.length ? <button disabled={busy} className="text-accent-fg" onClick={() => void cite(item.evidenceSegmentIds, item.evidenceRevision)}>{zh ? '查看原话' : 'Source'}</button> : null}{task ? task.deleted ? <span>{zh ? '关联任务已删除' : 'Linked task deleted'}</span> : <Link className="text-accent-fg" to={taskDetailHref(`${location.pathname}${location.search}`, task.taskId)}>{task.resolution === 'done' ? (zh ? '已完成 · 查看任务' : 'Done · View task') : (zh ? '查看任务 / 交给助手' : 'View task / Delegate')}</Link> : item.ignored ? null : <Button disabled={busy || (Boolean(item.supersededBy || item.disputedBy) && item.reviewedChangeId !== (item.supersededBy ?? item.disputedBy))} onClick={() => void operation(() => fetchJson(apiUrl(`${base}/actions/${encodeURIComponent(item.id)}/convert`), { method: 'POST', body: JSON.stringify({ organizationRevision: record.revision }) }))}>{zh ? '加入我的任务' : 'Add to my tasks'}</Button>}</div></article>;
        })}</section> : null}
        {facts(zh ? '风险' : 'Risks', organization.risks, 'risks')}{facts(zh ? '尚未确定' : 'Open questions', organization.openQuestions, 'openQuestions')}
        {organization.changes?.length ? <section className="space-y-3"><h3 className="font-semibold">{zh ? '前后变更' : 'Changes during the meeting'}</h3>{organization.changes.map(change => {
          const all = [...organization.decisions, ...organization.actionItems, ...organization.risks, ...organization.openQuestions];
          const before = all.find(item => item.id === change.fromId); const after = all.find(item => item.id === change.toId);
          if (!before || !after) return null;
          return <article key={`${change.fromId}:${change.toId}`} className="space-y-2 rounded border border-edge p-3 text-sm"><p className="text-xs text-fg-muted">{change.relation === 'supersedes' ? (zh ? '后续撤销或替代' : 'Later superseded') : (zh ? '存在冲突，尚未明确解决' : 'Unresolved conflict')}</p><button className="block text-left text-accent-fg" onClick={() => void cite(before.evidenceSegmentIds, before.evidenceRevision)}>{'title' in before ? before.title : before.text}</button><span>↓</span><button className="block text-left text-accent-fg" onClick={() => void cite(after.evidenceSegmentIds, after.evidenceRevision)}>{'title' in after ? after.title : after.text}</button></article>;
        })}</section> : null}

      </div> : <div className="mx-auto max-w-3xl space-y-4 py-3"><h3 className="text-base font-medium">{transcript.text ? (zh ? '录音摘录' : 'From your recording') : (zh ? '笔记正在整理' : 'Preparing your note')}</h3><p className={`whitespace-pre-wrap text-[15px] leading-7 ${transcript.text ? 'text-fg' : 'text-fg-muted'}`}>{transcript.text ? transcript.text.slice(0,400) + (transcript.text.length > 400 ? '…' : '') : (zh ? '文字整理完成后，重点和行动会出现在这里。' : 'Highlights and actions will appear as processing completes.')}</p>{transcript.text ? <Button className="min-h-11" onClick={() => setTab('transcript')}>{zh ? '查看原文' : 'Read transcript'}</Button> : null}</div>

      : <div className="space-y-4">{filtered.slice(0, page * 50).map(segment => <article id={`discussion-segment-${segment.sequence}`} key={segment.sequence} className={`rounded-md border p-3 ${(focused.includes(segment.sequence) || (review.anchor === segment.sequence && review.anchorRevision === transcript.revision)) ? 'border-accent' : 'border-edge-subtle'}`}>
        <div className="mb-2 flex items-center gap-3 text-xs text-fg-muted"><button className="inline-flex items-center gap-1 text-accent-fg" disabled={!discussion.audioAttachmentId || !!discussion.audioDeletedAt} onClick={() => void cite([segment.sequence],transcript.revision,true)}><Play className="size-3" />{clock(segment.startedAtMs)}</button>{segment.status === 'confirmed' ? <button onClick={() => void markSegment(segment)}>{zh ? '标记此段' : 'Highlight segment'}</button> : null}<span>{segment.speakerLabel ?? (zh ? '未区分说话人' : 'Speaker unknown')}</span>{editable && segment.status === 'confirmed' ? <button className="ml-auto" onClick={() => setEditing({ segment, text: segment.displayText ?? segment.rawText ?? '', speaker: segment.speakerLabel ?? '' })}>{zh ? '校对' : 'Edit'}</button> : null}</div>
        <p className="whitespace-pre-wrap text-sm leading-6">{segment.displayText ?? segment.rawText ?? (zh ? '等待转写' : 'Awaiting transcription')}</p>
      </article>)}{filtered.length > page * 50 ? <Button onClick={() => setPage(page + 1)}>{zh ? '加载更多' : 'More'}</Button> : null}</div>}
      </div>
      <div>
      <DiscussionLongReview key={discussion.id} id={discussion.id} query={query.trim()} zh={zh} sourceKey={`${discussion.audioSha256}:${discussion.audioDeletedAt}`} active={processing || discussion.status === 'recording'} tab={tab} refreshKey={`${discussion.updatedAt}:${transcript.revision}:${record?.revision}`} onEvidence={showEvidence} onPlay={seek} /></div>
    </main>
    {discussion.audioAttachmentId && !discussion.audioDeletedAt ? <footer className="shrink-0 border-t border-edge-subtle p-3"><audio ref={audio} controls preload="metadata" className="h-10 w-full" src={apiUrl(`${base}/audio`)} onTimeUpdate={() => { const current = (audio.current?.currentTime ?? 0) * 1000; setPlayingAt(current); updateReview(noteId,{ positionMs: current }); if (rangeEnd.current !== null && current >= rangeEnd.current) { audio.current?.pause(); rangeEnd.current = null; } }} onLoadedMetadata={() => { if (pendingSeek.current !== null && audio.current) { audio.current.currentTime = pendingSeek.current; pendingSeek.current = null; void audio.current.play().catch(() => undefined); } else if (audio.current) audio.current.currentTime = review.positionMs / 1000; }} onError={() => setError(zh ? '录音暂不可播放' : 'Recording unavailable')} /></footer> : null}
    {evidence ? <aside aria-label={zh ? '原话证据' : 'Source evidence'} className="absolute inset-y-0 right-0 z-10 flex w-[min(26rem,100%)] flex-col border-l border-edge bg-surface-panel">
      <header className="flex shrink-0 items-center justify-between border-b border-edge p-4"><h3>{zh ? '原话证据' : 'Source evidence'} · v{evidence.transcriptRevision}</h3><button aria-label={zh ? '关闭' : 'Close'} onClick={() => setEvidence(null)}><X className="size-4" /></button></header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-xs text-fg-muted">{zh ? '按整段定位，不代表词句级时间。' : 'Segment timing; not word-level alignment.'}</p>
        {evidence.stale ? <p className="text-xs text-fg-muted">{zh ? '原文已更新，以下保留当时版本的依据。' : 'Transcript updated; showing the original evidence revision.'}</p> : null}
        {!evidence.audioAvailable || !evidence.timingVerified ? <p className="text-xs text-fg-muted">{zh ? '原文仍可查看；原音不可用或时间定位待核实。' : 'Text remains available; audio is missing or timing is unverified.'}</p> : null}
        {evidence.segments.map(segment => <article key={segment.sequence} className="space-y-2 rounded border border-edge p-3">
          <p className="text-xs text-fg-muted">{clock(segment.startedAtMs)}–{clock(segment.endedAtMs)} · {segment.speakerLabel ?? (zh ? '说话人未明确' : 'Unknown speaker')}</p><p className="whitespace-pre-wrap text-sm leading-7">{segment.text}</p>
          {segment.playback.map((range,index) => <Button key={index} onClick={() => seek(range.startedAtMs,range.endedAtMs)}>{zh ? '播放原话' : 'Play source'} {clock(range.startedAtMs)}–{clock(range.endedAtMs)}</Button>)}
          {!evidence.stale ? <Button onClick={() => {
            setQuery(''); setPage(Math.max(page,Math.ceil((transcript.segments.findIndex(item => item.sequence === segment.sequence) + 1) / 50))); setTab('transcript'); setFocused([segment.sequence]); setEvidence(null); updateReview(noteId,{ anchor: segment.sequence,anchorRevision: transcript.revision });
            window.setTimeout(() => document.getElementById(`discussion-segment-${segment.sequence}`)?.scrollIntoView?.({ block: 'center' }),0);
          }}>{zh ? '定位原文' : 'Locate transcript'}</Button> : null}
        </article>)}
      </div>
    </aside> : null}
    {edit && record ? <MeetingEditDialog key={`${edit.kind}:${edit.itemId}:${record.revision}`} initial={edit} zh={zh} busy={busy} onClose={() => setEdit(null)} onSave={draft => operation(async () => {
      await fetchJson(apiUrl(`${base}/summary`), { method: 'PATCH', body: JSON.stringify({ ...draft, expectedRevision: record.revision }) });
      setEdit(null);
    })} /> : null}
    {editing ? <Dialog.Root open onOpenChange={open => { if (!open) setEditing(null); }}><Dialog.Portal><Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[70] bg-scrim backdrop-blur-[2px]" /><Dialog.Content aria-describedby={undefined} className="xopc-dialog-content fixed left-1/2 top-1/2 z-[71] flex h-[min(28rem,90dvh)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay"><header className="flex items-center justify-between border-b border-edge p-4"><Dialog.Title>{zh ? '校对逐字稿' : 'Edit transcript'}</Dialog.Title><button aria-label={zh ? '关闭校对' : 'Close editor'} onClick={() => setEditing(null)}><X className="size-4" /></button></header><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"><label className="block text-xs">{zh ? '本段说话人' : 'Speaker for this segment'}<input className="mt-1 w-full rounded border border-edge bg-surface-inset p-2 text-sm" value={editing.speaker} onChange={event => setEditing({ ...editing, speaker: event.target.value })} /></label>{editing.segment.speakerLabel ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="ui-checkbox" checked={Boolean(editing.applyToSpeakerGroup)} onChange={event => setEditing({ ...editing, applyToSpeakerGroup: event.target.checked })} />{zh ? '同时更名所有同标签片段；输入已有标签可合并说话人' : 'Rename all segments with this label; use an existing label to merge speakers'}</label> : null}<textarea className="min-h-32 w-full rounded border border-edge bg-surface-inset p-2 text-sm" value={editing.text} onChange={event => setEditing({ ...editing, text: event.target.value })} /></div><footer className="border-t border-edge p-3"><Button variant="primary" disabled={busy || !editing.text.trim()} onClick={() => void operation(async () => {
      await fetchJson<DiscussionTranscript>(apiUrl(`${base}/segments/${editing.segment.sequence}`), { method: 'PATCH', body: JSON.stringify({ displayText: editing.text, speakerLabel: editing.speaker, expectedRevision: editing.segment.revision, applyToSpeakerGroup: editing.applyToSpeakerGroup, expectedTranscriptRevision: transcript.revision }) });
      setEditing(null);
    })}><Check className="size-4" />{zh ? '保存修订' : 'Save revision'}</Button></footer></Dialog.Content></Dialog.Portal></Dialog.Root> : null}
  </section>;
}
