import { DiscussionTools, DiscussionOrganizeSettings, type DiscussionNoteManagementActions } from './discussion-tools';
import { RecordingOutcomeCard, recordingOutcomeInput } from './recording-outcome-card';
import { useDiscussionReading } from './use-discussion-reading';
import { useReadingPosition } from './use-reading-position';
import { DiscussionLongReview } from './discussion-long-review';
import type { DiscussionEvidence } from '@xopcai/gateway-contract';
import * as Dialog from '@radix-ui/react-dialog';
import { Bookmark, Check, Play, Search, SquarePen, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
function positionPlayer(player: HTMLAudioElement, seconds: number) {
  player.currentTime = Number.isFinite(player.duration) ? Math.min(seconds, player.duration) : seconds;
}

type ActionTask = { actionId: string; taskId: string; phase?: string; resolution?: string; deleted: boolean };

export function DiscussionNoteSections({ noteId, onPersonalNotes, onMeetingContent, personalNotes, personalNotesActive = false, noteTitle, noteActions }: { noteId: string; onPersonalNotes?: () => void; onMeetingContent?: () => void; personalNotes?: ReactNode; personalNotesActive?: boolean; noteTitle?: ReactNode; noteActions?: DiscussionNoteManagementActions }) {
  const location = useLocation();
  const notesPanelId = useId();
  const notesToggle = useRef<HTMLButtonElement>(null);
  const zh = useLocaleStore(state => state.language) === 'zh';
  const { data: latestDetail, mutate, isLoading } = useSWR(['note-discussion-document', noteId], () => getDiscussionForNote(noteId), { refreshInterval: data => data && (['recording', 'stopping', 'sealing', 'organizing'].includes(data.discussion.status) || data.recordingJob?.state === 'queued' || data.recordingJob?.state === 'running') ? 3_000 : 0 });
  const [editing, setEditing] = useState<{ segment: DiscussionTranscriptSegment; text: string; speaker: string; applyToSpeakerGroup?: boolean } | null>(null);
  const [edit, setEdit] = useState<MeetingEditDraft | null>(null);
  const readingViewport = useRef<HTMLElement>(null);
  const preserveReading = useReadingPosition(readingViewport);
  const { detail, hasUpdates, publish } = useDiscussionReading(noteId,latestDetail,preserveReading,!!editing || !!edit);
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
  const evidencePanel = useRef<HTMLElement>(null);
  const evidenceOrigin = useRef<{ element: HTMLElement | null; scrollTop: number; triggerIndex: number; review: typeof review } | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [returnAvailable, setReturnAvailable] = useState(false);
  const restoreReading = useRef(false);
  const closedEvidenceTrigger = useRef<HTMLElement | null>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const [evidence, setEvidence] = useState<DiscussionEvidence | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const page = review.page; const setPage = (page: number) => updateReview(noteId,{ page });
  const rangeEnd = useRef<number | null>(null);
  const [focused, setFocused] = useState<number[]>([]);
  const sourceGeneration = useRef(0);
  const evidenceRequest = useRef(0);
  const currentTranscriptRevision = useRef(latestDetail?.transcript.revision); currentTranscriptRevision.current = latestDetail?.transcript.revision;
  const audio = useRef<HTMLAudioElement>(null);
  const audioDeleted = useRef(latestDetail?.discussion.audioDeletedAt); audioDeleted.current = latestDetail?.discussion.audioDeletedAt;
  const pendingSeek = useRef<number | null>(null);
  const [mediaDuration, setMediaDuration] = useState<{ source: string; ms: number }>();


  useEffect(() => {
    const refresh = () => { void mutate(); void refreshTasks(); };
    const refreshNote = (event: Event) => { if ((event as CustomEvent<{ noteId?: string }>).detail?.noteId === noteId) refresh(); };
    window.addEventListener('note-updated', refreshNote);
    window.addEventListener('discussion-updated', refresh);
    window.addEventListener('discussion-segment-updated', refresh);
    return () => { window.removeEventListener('note-updated', refreshNote); window.removeEventListener('discussion-updated', refresh); window.removeEventListener('discussion-segment-updated', refresh); };
  }, [mutate, refreshTasks, noteId]);
  useEffect(() => { if (detail?.discussion.template) setTemplate(detail.discussion.template); }, [detail?.discussion.template]);

  async function operation(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); const updated = await mutate(); publish(updated); await refreshTasks(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }
  function seek(ms: number,endMs?: number) {
    if (!audio.current) return;
    const player = audio.current;
    const seconds = ms / 1000;
    rangeEnd.current = endMs ?? null;
    pendingSeek.current = player.readyState === 0 ? seconds : null;
    positionPlayer(player, seconds);
    void player.play().catch(() => undefined);
  }
  function rememberReading() {
    if (evidenceOrigin.current) return;
    const element = lastTrigger.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    evidenceOrigin.current = { element, triggerIndex: Array.from(readingViewport.current?.querySelectorAll('button') ?? []).findIndex(button => button === element), scrollTop: readingViewport.current?.scrollTop ?? 0, review };
  }
  function clearEvidenceNavigation() {
    evidenceRequest.current++;
    setEvidenceLoading(false);
    setEvidence(null);
    setReturnAvailable(false);
    setFocused([]);
    evidenceOrigin.current = null;
    closedEvidenceTrigger.current = null;
  }
  function closeEvidence() {
    evidenceRequest.current++; setEvidenceLoading(false); setEvidence(null);
    closedEvidenceTrigger.current = evidenceOrigin.current?.element ?? null;
    if (!returnAvailable) evidenceOrigin.current = null;
  }
  function returnToConclusion() {
    const origin = evidenceOrigin.current; if (!origin) return;
    const { tab, query, page, anchor, anchorRevision } = origin.review;
    updateReview(noteId,{ tab, query, page, anchor, anchorRevision }); setFocused([]); setEvidence(null); setReturnAvailable(false); restoreReading.current = true;
  }
  useLayoutEffect(() => {
    if (!evidence && !evidenceLoading && closedEvidenceTrigger.current) {
      closedEvidenceTrigger.current.focus({ preventScroll: true }); closedEvidenceTrigger.current = null;
    }
    if (!restoreReading.current) return;
    restoreReading.current = false;
    const origin = evidenceOrigin.current;
    if (origin && readingViewport.current) readingViewport.current.scrollTop = origin.scrollTop;
    const trigger = origin?.element?.isConnected ? origin.element : origin && origin.triggerIndex >= 0 ? readingViewport.current?.querySelectorAll('button')[origin.triggerIndex] : null;
    trigger?.focus({ preventScroll: true }); evidenceOrigin.current = null;
  });
  useEffect(() => {
    if (evidence || evidenceLoading) evidencePanel.current?.focus({ preventScroll: true });
  },[evidence,evidenceLoading]);
  function showEvidence(value: DiscussionEvidence) {
    if (personalNotesActive) onMeetingContent?.();
    rememberReading();
    const stale = value.stale || value.transcriptRevision !== currentTranscriptRevision.current;
    const safe = audioDeleted.current ? { ...value, audioAvailable: false, timingVerified: false, segments: value.segments.map(segment => ({ ...segment, playback: [] })) } : value;
    setEvidence({ ...safe,stale }); if (!stale) setFocused(value.segments.map(segment => segment.sequence));
  }
  async function cite(refs: number[], revision?: number) {
    if (!detail) return;
    const generation = sourceGeneration.current; const request = ++evidenceRequest.current;
    if (personalNotesActive) onMeetingContent?.();
    rememberReading(); setEvidenceLoading(true); setEvidence(null); setError(null);
    try {
      const result = await fetchJson<DiscussionEvidence>(apiUrl(`${base}/evidence?revision=${revision ?? detail.organization?.transcriptRevision ?? detail.transcript.revision}&segments=${refs.join(',')}`));
      if (generation !== sourceGeneration.current || request !== evidenceRequest.current) return;
      showEvidence(result);
    } catch (caught) {
      if (generation === sourceGeneration.current && request === evidenceRequest.current) { setError(caught instanceof Error ? caught.message : String(caught)); closeEvidence(); }
    } finally { if (request === evidenceRequest.current) setEvidenceLoading(false); }
  }
  async function playTranscriptSegment(segment: DiscussionTranscriptSegment) {
    if (!detail || audioDeleted.current || !audio.current) return;
    if (evidence || evidenceLoading || returnAvailable) clearEvidenceNavigation();
    const generation = sourceGeneration.current;
    const request = ++evidenceRequest.current;
    setError(null);
    if (detail.discussion.mimeType?.split(';')[0] === 'audio/wav' && segment.endedAtMs > segment.startedAtMs) {
      seek(segment.startedAtMs, segment.endedAtMs);
      return;
    }
    try {
      const result = await fetchJson<DiscussionEvidence>(apiUrl(`${base}/evidence?revision=${detail.transcript.revision}&segments=${segment.sequence}`));
      if (generation !== sourceGeneration.current || request !== evidenceRequest.current || audioDeleted.current) return;
      const range = result.segments.find(item => item.sequence === segment.sequence)?.playback[0];
      if (!range) {
        setError(zh ? '这段录音暂无法定位' : 'This segment cannot be located yet');
        return;
      }
      setFocused([]);
      seek(range.startedAtMs, range.endedAtMs);
    } catch (caught) {
      if (generation === sourceGeneration.current && request === evidenceRequest.current) setError(caught instanceof Error ? caught.message : String(caught));
    }
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
    sourceGeneration.current++; evidenceRequest.current++; evidenceOrigin.current = null; setReturnAvailable(false); setEvidenceLoading(false); setEvidence(null); setFocused([]); setEditing(null); setEdit(null); setSelected([]); setError(null); rangeEnd.current = null;
    return () => { sourceGeneration.current++; };
  },[noteId]);
  useEffect(() => {
    const source = detail?.discussion.audioSha256 ?? detail?.discussion.audioAttachmentId;
    if (!source) return;
    const saved = readReviewState(noteId,useDiscussionReviewState.getState().notes[noteId]);
    if (saved.source && saved.source !== source) { sourceGeneration.current++; evidenceRequest.current++; setEvidenceLoading(false); setEvidence(null); setFocused([]); audio.current?.pause(); updateReview(noteId,{ positionMs: 0,source }); pendingSeek.current = 0; rangeEnd.current = null; }
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
    setEvidence(previous => previous && previous.transcriptRevision !== latestDetail?.transcript.revision ? { ...previous,stale: true } : previous);
  },[latestDetail?.transcript.revision]);
  function sourceLink(refs: number[], revision?: number, label = zh ? '原话' : 'Source') {
    const current = detail && (revision ?? detail.organization?.transcriptRevision ?? detail.transcript.revision) === detail.transcript.revision;
    const segment = current ? detail.transcript.segments.find(item => item.sequence === refs[0]) : undefined;
    return <button type="button" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-accent-fg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={segment ? `${label} · ${clock(segment.startedAtMs)}` : undefined}
      onClick={() => void cite(refs, revision)}>
      {segment ? <span className="tabular-nums">{clock(segment.startedAtMs)}</span> : label}
    </button>;
  }

  const facts = (title: string, items: DiscussionFact[], kind: 'decisions' | 'risks' | 'openQuestions') => items.some(item => showIgnored || !item.ignored) ? <section className="space-y-2"><h3 className="font-semibold text-fg">{title}</h3>{items.filter(item => showIgnored || !item.ignored).map(item => <div data-reading-anchor={`fact:${item.id}`} key={item.id} className="flex items-start gap-3 text-sm"><p className="flex-1 whitespace-pre-wrap">{item.text}{item.supersededBy || item.disputedBy ? <span className="ml-2 text-xs text-fg-muted">{zh ? '有后续变更' : 'Later changes'}</span> : null}{item.editedByUser ? <span className="ml-2 text-xs text-fg-muted">{zh ? (item.ignored ? '已忽略' : '人工编辑') : (item.ignored ? 'Ignored' : 'Edited')}</span> : null}</p><button className="text-xs text-fg-muted" disabled={busy || hasUpdates} onClick={() => setEdit({ kind, itemId: item.id, text: item.text, ignored: item.ignored })}>{zh ? '编辑' : 'Edit'}</button>{item.evidenceSegmentIds.length ? sourceLink(item.evidenceSegmentIds, item.evidenceRevision) : <span className="text-xs text-fg-muted">{zh ? '暂无定位' : 'No source timing'}</span>}</div>)}</section> : null;

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!detail) return null;
  const { discussion, transcript, organization: record } = detail;
  const organization = record?.organization;
  const displayTitle = !detail.note.title || /^Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(detail.note.title)
    ? (zh ? '语音笔记' : 'Voice note')
    : detail.note.title;
  const createdAt = discussion.recordingStartedAt ?? detail.note.createdAt;
  const created = createdAt ? new Date(createdAt).toLocaleDateString(zh ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' }) : null;
  const audioSource = discussion.audioSha256 ?? discussion.audioAttachmentId ?? '';
  const durationMs = mediaDuration?.source === audioSource ? mediaDuration.ms : (discussion.durationMs ?? 0);
  const audioAvailable = !!discussion.audioAttachmentId && !discussion.audioDeletedAt;
  const processing = ['stopping', 'sealing', 'organizing'].includes(discussion.status);
  const editable = !hasUpdates && ['recording', 'completed', 'needs_attention'].includes(discussion.status);
  const sidePanelOpen = personalNotesActive || !!evidence || evidenceLoading;
  const filtered = transcript.segments.filter(segment => (segment.displayText ?? segment.rawText ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase()) || segment.speakerLabel?.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pageText = personalNotesActive ? detail.note.markdown : tab === 'marks' || query.trim() ? '' : discussionPageText(detail, tab, { query, page, showIgnored });
  return <section className="@container/discussion relative flex h-full min-h-0 min-w-0 w-full flex-col text-fg" onClickCapture={event => { lastTrigger.current = event.target instanceof Element ? event.target.closest('button') : null; }} onKeyDown={event => {
    if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key === 'f') {
      event.preventDefault();
      if (personalNotesActive && readingViewport.current && getComputedStyle(readingViewport.current).visibility === 'hidden') onMeetingContent?.();
      if (searchOpen) window.requestAnimationFrame(() => searchInput.current?.focus());
      else setSearchOpen(true);
    }
  }}>
    <header className="flex shrink-0 flex-wrap items-start gap-x-4 gap-y-1 px-5 pb-3 pt-5 sm:px-7">
      <div className="min-w-40 flex-1">
        {noteTitle ?? <h2 className="break-words text-2xl font-semibold leading-snug tracking-tight">{displayTitle}</h2>}
        <p className="mt-1 text-xs tabular-nums text-fg-muted">{[created, clock(durationMs)].filter(Boolean).join(' · ')}</p>
      </div>
      <DiscussionTools noteActions={noteActions} detail={detail} zh={zh} busy={busy} processing={processing} pageText={pageText} editing={!!edit || !!editing} />
    </header>
    <div className="mx-5 mb-2 flex shrink-0 flex-wrap items-center justify-between gap-x-2 border-b border-edge-subtle pb-2 sm:mx-7">
      <nav aria-label={zh ? '录音内容' : 'Recording content'} className="inline-flex items-center rounded-xl bg-surface-inset px-1">
        {(['summary','transcript'] as const).map(value => {
          const active = tab === value || (value === 'transcript' && tab === 'marks');
          return <button key={value} type="button" aria-pressed={active} className="group relative isolate min-h-11 rounded-lg px-3.5 text-sm text-fg-muted aria-pressed:font-medium aria-pressed:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => {
              if (personalNotesActive && readingViewport.current && getComputedStyle(readingViewport.current).visibility === 'hidden') onMeetingContent?.();
              clearEvidenceNavigation();
              setTab(value);
            }}>
            <span aria-hidden className="absolute inset-x-0 inset-y-1.5 -z-10 rounded-lg group-aria-pressed:bg-surface-panel group-aria-pressed:shadow-sm" />
            {value === 'summary' ? (zh ? '纪要' : 'Summary') : (zh ? '转写' : 'Transcript')}
          </button>;
        })}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <button type="button" aria-label={zh ? '搜索' : 'Search'} aria-expanded={searchOpen || !!query}
          onClick={() => { if (personalNotesActive) onMeetingContent?.(); setSearchOpen(open => !open); if (searchOpen) setQuery(''); }}
          className="inline-flex size-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent">
          <Search className="size-4" aria-hidden />
        </button>
        {personalNotes ? <button ref={notesToggle} type="button" aria-expanded={personalNotesActive} aria-controls={notesPanelId}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-accent-fg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => {
            if (personalNotesActive) onMeetingContent?.();
            else { clearEvidenceNavigation(); onPersonalNotes?.(); }
          }}>
          {personalNotesActive ? <Check className="size-4" aria-hidden /> : <SquarePen className="size-4" aria-hidden />}
          {personalNotesActive ? (zh ? '完成' : 'Done') : (zh ? '写笔记' : 'Write notes')}
        </button> : null}
      </div>
    </div>
    {error ? <details role="alert" className="px-4 py-2 text-sm text-danger"><summary>{zh ? '操作未完成，可以稍后重试' : 'Action incomplete. Try again later'}</summary><p className="mt-2 break-words text-xs text-fg-muted">{error}</p></details> : null}

    {(searchOpen || query) ? <label className={`mx-5 mb-2 shrink-0 items-center gap-2 rounded-xl bg-surface-inset px-3 sm:mx-7 ${personalNotesActive ? 'hidden @min-[58rem]/discussion:flex' : 'flex'}`}><Search className="size-4 text-fg-muted" /><input ref={searchInput} aria-label={zh ? '搜索录音内容' : 'Search recording'} className="min-h-11 min-w-0 w-full bg-transparent text-sm outline-none" maxLength={200} placeholder={zh ? '搜索录音内容' : 'Search recording'} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /><button className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? '关闭搜索' : 'Close search'} onClick={() => { setQuery(''); setSearchOpen(false); }}><X className="size-4" /></button></label> : null}
    {returnAvailable ? <div className="flex shrink-0 items-center px-5 pb-2 text-xs text-fg-muted sm:px-7"><Button variant="ghost" onClick={returnToConclusion}>{evidenceOrigin.current?.review.tab === 'summary' ? (zh ? '返回结论' : 'Back to conclusion') : (zh ? '返回阅读位置' : 'Back to reading')}</Button></div> : null}
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <main ref={readingViewport} className={`min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-6 pt-3 sm:px-7 ${sidePanelOpen ? 'invisible @min-[58rem]/discussion:visible' : ''} flex`}>
      {tab !== 'summary' && !query.trim() ? <div className="mx-auto flex w-full max-w-[46rem] justify-end"><Button variant="ghost" aria-pressed={tab === 'marks'} onClick={() => setTab(tab === 'marks' ? 'transcript' : 'marks')} className="min-h-11 gap-1.5 aria-pressed:bg-surface-inset"><Bookmark className="size-4" aria-hidden />{zh ? '我的标记' : 'My highlights'}</Button></div> : null}
      {(discussion.status !== 'completed' || !organization || record?.transcriptRevision !== transcript.revision) && (discussion.status !== 'recording' || detail.recordingJob) ? <RecordingOutcomeCard context="note" nextAttemptAt={detail.processing?.nextAttemptAt} input={recordingOutcomeInput(detail)} zh={zh} busy={busy} onRetry={mode => void operation(() => mode === 'analyze' ? fetchJson(apiUrl(`${base}/organize`), { method: 'POST', body: JSON.stringify({ template }) }) : retryDiscussion(discussion.id, mode === 'regenerate' ? 'from_audio' : 'resume'))} /> : null}
      <div className="mx-auto w-full max-w-[46rem]" hidden={!!query.trim()}>
      {tab === 'marks' ? <DiscussionAnnotations key={discussion.id} recordingId={discussion.clientRequestId} discussionId={discussion.id} zh={zh} onEvidence={showEvidence} onPlay={range => seek(range.startedAtMs,range.endedAtMs)} /> : tab === 'summary' ? organization ? <div className="mx-auto w-full max-w-[46rem] space-y-6">
        <div className="flex items-center justify-between gap-3"><h3 className="text-base font-medium">{zh ? '摘要' : 'Summary'}</h3><div className="flex items-center gap-1"><DiscussionOrganizeSettings detail={detail} template={template} onTemplate={setTemplate} zh={zh} busy={busy} processing={processing}
        onOrganize={() => void operation(() => fetchJson(apiUrl(`${base}/organize`),{ method: 'POST',body: JSON.stringify({ template }) }))}
        onRegenerate={() => void operation(() => retryDiscussion(discussion.id,'from_audio'))} /><button className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? '编辑概要' : 'Edit overview'} title={zh ? '编辑概要' : 'Edit overview'} disabled={busy || processing || hasUpdates} onClick={() => setEdit({ kind: 'summary', itemId: 'summary', text: organization.summary })}><SquarePen className="size-4" aria-hidden /></button></div></div>
        <p data-reading-anchor="summary" className="whitespace-pre-wrap text-[15px] leading-7">{organization.summary}</p>{organization.summaryEditedByUser ? <p className="text-xs text-fg-muted">{zh ? '已由你编辑' : 'Edited by you'}</p> : null}
        {organization.summaryEvidenceSegmentIds?.length ? Array.from({ length: Math.ceil(organization.summaryEvidenceSegmentIds.length / 100) },(_,index) => <Button key={index} onClick={() => void cite(organization.summaryEvidenceSegmentIds!.slice(index * 100,(index + 1) * 100))}>{zh ? '查看原话' : 'View source'}{organization.summaryEvidenceSegmentIds!.length > 100 ? ` · ${index + 1}` : ''}</Button>) : null}
        {organization.keyPointEvidence?.length ? <section className="space-y-2"><h3>{zh ? '重点结论' : 'Key points'}</h3>{organization.keyPointEvidence.map(point => <div key={point.id} className="flex gap-2 text-sm"><p className="flex-1">{point.text}</p>{sourceLink(point.evidenceSegmentIds, point.evidenceRevision)}</div>)}</section> : organization.keyPoints.length ? <section className="space-y-3"><h3 className="text-base font-medium">{zh ? '重点结论' : 'Key points'}</h3><ul className="list-disc space-y-2 pl-5 text-[15px] leading-7">{organization.keyPoints.map((point,index) => <li key={`${index}:${point}`}>{point}</li>)}</ul></section> : null}
        {[...organization.decisions,...organization.actionItems,...organization.risks,...organization.openQuestions].some(item => item.ignored) ? <label className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" className="ui-checkbox" checked={showIgnored} onChange={event => setShowIgnored(event.target.checked)} />{zh ? '显示已忽略项' : 'Show ignored items'}</label> : null}
        {selected.length ? <Button disabled={busy || hasUpdates} onClick={() => void operation(async () => {
          for (const actionId of selected) await fetchJson(apiUrl(`${base}/actions/${encodeURIComponent(actionId)}/convert`), { method: 'POST', body: JSON.stringify({ organizationRevision: record.revision }) });
          setSelected([]);
        })}>{zh ? `加入所选 ${selected.length} 项任务` : `Add ${selected.length} selected tasks`}</Button> : null}
        {facts(zh ? '已决定事项' : 'Decisions', organization.decisions, 'decisions')}
        {organization.actionItems.length ? <section className="space-y-3"><h3 className="font-semibold">{zh ? '下一步行动' : 'Next actions'}</h3>{organization.actionItems.filter(item => showIgnored || !item.ignored).map(item => {
          const task = tasks.find(candidate => candidate.actionId === item.id);
          return <article data-reading-anchor={`action:${item.id}`} key={item.id} className="rounded-lg border border-edge-subtle p-3"><div className="flex items-start gap-2">{!task && !item.ignored && (!(item.supersededBy || item.disputedBy) || item.reviewedChangeId === (item.supersededBy ?? item.disputedBy)) ? <input type="checkbox" aria-label={`${zh ? '选择行动' : 'Select action'}: ${item.title}`} className="ui-checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} /> : null}<p className="flex-1 text-sm font-medium">{item.title}{item.supersededBy || item.disputedBy ? <span className="ml-2 text-xs text-fg-muted">{zh ? '有后续变更，请复核' : 'Review later changes'}</span> : null}{item.editedByUser ? <span className="ml-2 text-xs text-fg-muted">{zh ? (item.ignored ? '已忽略' : '人工编辑') : (item.ignored ? 'Ignored' : 'Edited')}</span> : null}</p><button className="text-xs text-fg-muted" disabled={busy || processing || hasUpdates} onClick={() => setEdit({ kind: 'actionItems', itemId: item.id, text: item.title, owner: item.owner, dueDate: item.dueDate, ignored: item.ignored })}>{zh ? '编辑' : 'Edit'}</button></div><p className="mt-1 text-xs text-fg-muted">{item.owner ?? (zh ? '负责人未明确' : 'Owner unspecified')} · {item.dueDate ?? (zh ? '期限未明确' : 'Date unspecified')}</p><div className="mt-3 flex flex-wrap items-center gap-3 text-xs">{item.evidenceSegmentIds.length ? sourceLink(item.evidenceSegmentIds, item.evidenceRevision, zh ? '查看原话' : 'Source') : null}{task ? task.deleted ? <span>{zh ? '关联任务已删除' : 'Linked task deleted'}</span> : <Link className="text-accent-fg" to={taskDetailHref(`${location.pathname}${location.search}`, task.taskId)}>{task.resolution === 'done' ? (zh ? '已完成 · 查看任务' : 'Done · View task') : (zh ? '查看任务 / 交给助手' : 'View task / Delegate')}</Link> : item.ignored ? null : <Button disabled={busy || hasUpdates || (Boolean(item.supersededBy || item.disputedBy) && item.reviewedChangeId !== (item.supersededBy ?? item.disputedBy))} onClick={() => void operation(() => fetchJson(apiUrl(`${base}/actions/${encodeURIComponent(item.id)}/convert`), { method: 'POST', body: JSON.stringify({ organizationRevision: record.revision }) }))}>{zh ? '加入我的任务' : 'Add to my tasks'}</Button>}</div></article>;
        })}</section> : null}
        {facts(zh ? '风险' : 'Risks', organization.risks, 'risks')}{facts(zh ? '尚未确定' : 'Open questions', organization.openQuestions, 'openQuestions')}
        {organization.changes?.length ? <section className="space-y-3"><h3 className="font-semibold">{zh ? '前后变更' : 'Changes during the meeting'}</h3>{organization.changes.map(change => {
          const all = [...organization.decisions, ...organization.actionItems, ...organization.risks, ...organization.openQuestions];
          const before = all.find(item => item.id === change.fromId); const after = all.find(item => item.id === change.toId);
          if (!before || !after) return null;
          return <article key={`${change.fromId}:${change.toId}`} className="space-y-2 rounded border border-edge p-3 text-sm"><p className="text-xs text-fg-muted">{change.relation === 'supersedes' ? (zh ? '后续撤销或替代' : 'Later superseded') : (zh ? '存在冲突，尚未明确解决' : 'Unresolved conflict')}</p><button className="block text-left text-accent-fg" onClick={() => void cite(before.evidenceSegmentIds, before.evidenceRevision)}>{'title' in before ? before.title : before.text}</button><span>↓</span><button className="block text-left text-accent-fg" onClick={() => void cite(after.evidenceSegmentIds, after.evidenceRevision)}>{'title' in after ? after.title : after.text}</button></article>;
        })}</section> : null}

      </div> : <div className="mx-auto w-full max-w-[46rem] space-y-4 py-3"><p className="whitespace-pre-wrap text-[15px] leading-7 text-fg-muted">{transcript.text ? transcript.text.slice(0,400) + (transcript.text.length > 400 ? '…' : '') : null}</p>{transcript.text ? <Button className="min-h-11" onClick={() => setTab('transcript')}>{zh ? '查看转写' : 'View transcript'}</Button> : null}</div>

      : <div className="divide-y divide-edge-subtle">{filtered.slice(0, page * 50).map(segment => <article data-reading-anchor={`segment:${segment.sequence}`} id={`discussion-segment-${segment.sequence}`} key={segment.sequence} className={`px-3 py-2 ${focused.includes(segment.sequence) || (review.anchor === segment.sequence && review.anchorRevision === transcript.revision) ? 'rounded-lg bg-accent-soft' : review.positionMs > 0 && review.positionMs >= segment.startedAtMs && review.positionMs < segment.endedAtMs ? 'rounded-lg bg-surface-inset' : ''}`}>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          <span>{segment.speakerLabel ?? (zh ? '未区分说话人' : 'Speaker unknown')}</span>
          {segment.status === 'confirmed' && !hasUpdates ? <button type="button" className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" onClick={() => void markSegment(segment)}><Bookmark className="size-3.5" aria-hidden />{zh ? '标记此段' : 'Highlight segment'}</button> : null}
          {editable && segment.status === 'confirmed' ? <button type="button" className="min-h-11 rounded-lg px-2 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" onClick={() => setEditing({ segment, text: segment.displayText ?? segment.rawText ?? '', speaker: segment.speakerLabel ?? '' })}>{zh ? '校对' : 'Edit'}</button> : null}
        </div>
        {audioAvailable && segment.status === 'confirmed' ? (
          <button type="button" className="flex min-h-11 w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => void playTranscriptSegment(segment)}>
            <span className="inline-flex shrink-0 items-center gap-1 pt-1 text-xs tabular-nums text-accent-fg"><Play className="size-3" aria-hidden /><span className="sr-only">{zh ? '回听' : 'Play'} </span>{clock(segment.startedAtMs)}</span>
            <span className="whitespace-pre-wrap break-words text-sm leading-6">{segment.displayText ?? segment.rawText}</span>
          </button>
        ) : (
          <p className="flex gap-3 px-2 py-2 text-sm leading-6"><span className="shrink-0 text-xs tabular-nums text-fg-muted">{clock(segment.startedAtMs)}</span><span className="whitespace-pre-wrap break-words">{segment.displayText ?? segment.rawText ?? (zh ? '等待转写' : 'Awaiting transcription')}</span></p>
        )}
      </article>)}{filtered.length > page * 50 ? <Button onClick={() => setPage(page + 1)}>{zh ? '加载更多' : 'More'}</Button> : null}</div>}
      </div>
      <div className="mx-auto w-full max-w-[46rem]">
      <DiscussionLongReview key={discussion.id} id={discussion.id} query={query.trim()} zh={zh} sourceKey={`${discussion.audioSha256}:${discussion.audioDeletedAt}`} active={processing || discussion.status === 'recording'} tab={tab} refreshKey={`${discussion.updatedAt}:${transcript.revision}:${record?.revision}`} onEvidence={showEvidence} onPlay={seek} /></div>
    </main>
      {personalNotes ? <aside id={notesPanelId} aria-label={zh ? '我的笔记' : 'My notes'} hidden={!personalNotesActive}
        className="absolute inset-0 z-10 min-h-0 min-w-0 overflow-hidden bg-surface-panel @min-[58rem]/discussion:static @min-[58rem]/discussion:w-[24rem] @min-[58rem]/discussion:shrink-0 @min-[58rem]/discussion:border-l @min-[58rem]/discussion:border-edge-subtle"
        onKeyDown={event => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          onMeetingContent?.();
          notesToggle.current?.focus();
        }}>{personalNotes}</aside> : null}
    {evidence || evidenceLoading ? <aside ref={evidencePanel} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeEvidence(); } }} aria-label={zh ? '原话证据' : 'Source evidence'} className="absolute inset-0 z-20 flex min-h-0 w-full min-w-0 flex-col border-edge bg-surface-panel outline-none @min-[58rem]/discussion:static @min-[58rem]/discussion:w-[22rem] @min-[58rem]/discussion:shrink-0 @min-[58rem]/discussion:border-l">
      <header className="flex shrink-0 items-center justify-between border-b border-edge p-4"><h3>{zh ? '原话证据' : 'Source evidence'} {evidence ? `· v${evidence.transcriptRevision}` : ''}</h3><button aria-label={zh ? '关闭' : 'Close'} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" onClick={closeEvidence}><X className="size-4" /></button></header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {evidenceLoading ? <div aria-busy="true" className="space-y-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-24 w-full" /></div> : null}
        {evidence ? <>
        <p className="text-xs text-fg-muted">{zh ? '按整段定位，不代表词句级时间。' : 'Segment timing; not word-level alignment.'}</p>
        {evidence.stale ? <p className="text-xs text-fg-muted">{zh ? '原文已更新，以下保留当时版本的依据。' : 'Transcript updated; showing the original evidence revision.'}</p> : null}
        {!evidence.audioAvailable || !evidence.timingVerified ? <p className="text-xs text-fg-muted">{zh ? '原文仍可查看；原音不可用或时间定位待核实。' : 'Text remains available; audio is missing or timing is unverified.'}</p> : null}
        {evidence.segments.map(segment => <article key={segment.sequence} className="space-y-2 rounded border border-edge p-3">
          <p className="text-xs text-fg-muted">{clock(segment.startedAtMs)}–{clock(segment.endedAtMs)} · {segment.speakerLabel ?? (zh ? '说话人未明确' : 'Unknown speaker')}</p><p className="whitespace-pre-wrap text-sm leading-7">{segment.text}</p>
          {segment.playback.map((range,index) => <Button key={index} onClick={() => seek(range.startedAtMs,range.endedAtMs)}>{zh ? '播放原话' : 'Play source'} {clock(range.startedAtMs)}–{clock(range.endedAtMs)}</Button>)}
          {!evidence.stale && evidence.transcriptRevision === latestDetail?.transcript.revision && evidence.transcriptRevision !== transcript.revision ? <Button onClick={() => publish()}>{zh ? '查看最新原文' : 'View latest transcript'}</Button> : null}
          {!evidence.stale && evidence.transcriptRevision === latestDetail?.transcript.revision && evidence.transcriptRevision === transcript.revision ? <Button onClick={() => {
            setQuery(''); setPage(Math.max(page,Math.ceil((transcript.segments.findIndex(item => item.sequence === segment.sequence) + 1) / 50))); setTab('transcript'); setFocused([segment.sequence]); setEvidence(null); setReturnAvailable(true); updateReview(noteId,{ anchor: segment.sequence,anchorRevision: transcript.revision });
            window.setTimeout(() => document.getElementById(`discussion-segment-${segment.sequence}`)?.scrollIntoView?.({ block: 'center' }),0);
          }}>{zh ? '定位原文' : 'Locate transcript'}</Button> : null}
        </article>)}
        </> : null}
      </div>
    </aside> : null}
    </div>
    {audioAvailable ? <footer className="shrink-0 border-t border-edge-subtle px-4 py-2">
      <audio key={audioSource} ref={audio} controls preload="metadata" className="h-10 w-full" src={apiUrl(`${base}/audio`)}
        aria-label={zh ? '录音播放器' : 'Recording player'}
        onDurationChange={event => {
          const seconds = event.currentTarget.duration;
          setMediaDuration(Number.isFinite(seconds) && seconds > 0 ? { source: audioSource, ms: Math.floor(seconds * 1000) } : undefined);
        }}
        onTimeUpdate={event => {
          const current = event.currentTarget.currentTime * 1000;
          updateReview(noteId, { positionMs: current });
          if (rangeEnd.current !== null && current >= rangeEnd.current) {
            event.currentTarget.pause();
            rangeEnd.current = null;
          }
        }}
        onLoadedMetadata={event => {
          const player = event.currentTarget;
          if (pendingSeek.current !== null) {
            positionPlayer(player, pendingSeek.current);
            pendingSeek.current = null;
            void player.play().catch(() => undefined);
          } else positionPlayer(player, review.source === audioSource ? review.positionMs / 1000 : 0);
        }}
        onError={() => setError(zh ? '录音暂不可播放' : 'Recording unavailable')}
      />
    </footer> : null}
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
