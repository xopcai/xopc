import * as Dialog from '@radix-ui/react-dialog';
import { Check, Download, FileText, Play, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PageContextCaptureButton } from '@/features/chat/context/page-context-capture-button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

import { MeetingEditDialog, type MeetingEditDraft } from './meeting-edit-dialog';
import { discussionPageText } from './discussion-page-context';
import { getDiscussionForNote, retryDiscussion } from './discussion-api';
import type { DiscussionFact, DiscussionTranscript, DiscussionTranscriptSegment, DiscussionTemplate } from './discussion-types';

const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
type ActionTask = { actionId: string; taskId: string; phase?: string; resolution?: string; deleted: boolean };

export function DiscussionNoteSections({ noteId }: { noteId: string }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const { data: detail, mutate, isLoading } = useSWR(['note-discussion-document', noteId], () => getDiscussionForNote(noteId), { refreshInterval: data => data && (['recording', 'stopping', 'sealing', 'organizing'].includes(data.discussion.status) || data.recordingJob?.state === 'queued' || data.recordingJob?.state === 'running') ? 3_000 : 0 });
  const id = detail?.discussion.id;
  const base = `/api/discussions/${encodeURIComponent(id ?? '')}`;
  const { data: tasks = [], mutate: refreshTasks } = useSWR<ActionTask[]>(id ? `${base}/actions` : null, path => fetchJson(apiUrl(path)), { refreshInterval: 10_000 });
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');
  const [query, setQuery] = useState('');
  const [template, setTemplate] = useState<DiscussionTemplate>('general');
  const [evidence, setEvidence] = useState<DiscussionTranscriptSegment[] | null>(null);
  const [editing, setEditing] = useState<{ segment: DiscussionTranscriptSegment; text: string; speaker: string; applyToSpeakerGroup?: boolean } | null>(null);
  const [edit, setEdit] = useState<MeetingEditDraft | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const audio = useRef<HTMLAudioElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [playingAt, setPlayingAt] = useState(0);

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
  function seek(ms: number) {
    if (!audio.current) return;
    if (audio.current.readyState === 0) { pendingSeek.current = ms / 1000; audio.current.load(); }
    else audio.current.currentTime = ms / 1000;
    void audio.current.play().catch(() => undefined);
  }
  async function cite(refs: number[], revision?: number) {
    if (!detail?.organization) return;
    await operation(async () => {
      const transcript = await fetchJson<DiscussionTranscript>(apiUrl(`${base}/transcript?revision=${revision ?? detail.organization!.transcriptRevision}`));
      setEvidence(transcript.segments.filter(segment => refs.includes(segment.sequence)));
    });
  }
  const facts = (title: string, items: DiscussionFact[], kind: 'decisions' | 'risks' | 'openQuestions') => items.some(item => showIgnored || !item.ignored) ? <section className="space-y-2"><h3 className="font-semibold text-fg">{title}</h3>{items.filter(item => showIgnored || !item.ignored).map(item => <div key={item.id} className="flex items-start gap-3 text-sm"><p className="flex-1 whitespace-pre-wrap">{item.text}{item.supersededBy || item.disputedBy ? <span className="ml-2 text-xs text-fg-muted">{zh ? '有后续变更' : 'Later changes'}</span> : null}{item.editedByUser ? <span className="ml-2 text-xs text-fg-muted">{zh ? (item.ignored ? '已忽略' : '人工编辑') : (item.ignored ? 'Ignored' : 'Edited')}</span> : null}</p><button className="text-xs text-fg-muted" disabled={busy} onClick={() => setEdit({ kind, itemId: item.id, text: item.text, ignored: item.ignored })}>{zh ? '编辑' : 'Edit'}</button>{item.evidenceSegmentIds.length ? <button disabled={busy} className="shrink-0 text-accent-fg" onClick={() => void cite(item.evidenceSegmentIds, item.evidenceRevision)}>{zh ? '原话' : 'Source'}</button> : <span className="text-xs text-fg-muted">{zh ? '暂无定位' : 'No source timing'}</span>}</div>)}</section> : null;

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!detail) return null;
  const { discussion, transcript, organization: record } = detail;
  const organization = record?.organization;
  const processing = ['stopping', 'sealing', 'organizing'].includes(discussion.status);
  const editable = ['recording', 'completed', 'needs_attention'].includes(discussion.status);
  const filtered = transcript.segments.filter(segment => (segment.displayText ?? segment.rawText ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase()) || segment.speakerLabel?.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pageText = discussionPageText(detail, tab, { query, page, showIgnored });
  return <section className="relative flex h-full min-h-0 w-full flex-col text-fg">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-edge-subtle p-4">
      <FileText className="size-4 text-accent" /><span className="text-sm font-medium">{clock(discussion.durationMs ?? 0)} · {processing ? (zh ? '正在整理' : 'Processing') : discussion.status === 'completed' ? (zh ? '整理完成' : 'Ready') : discussion.status}</span>
      <div className="ml-auto flex items-center gap-2"><Select value={template} aria-label={zh ? '纪要模板' : 'Summary template'} onChange={event => setTemplate(event.target.value as DiscussionTemplate)}>
        <SelectOption value="general">{zh ? '通用会议' : 'General'}</SelectOption><SelectOption value="project">{zh ? '项目例会' : 'Project'}</SelectOption><SelectOption value="review">{zh ? '需求评审' : 'Review'}</SelectOption><SelectOption value="interview">{zh ? '客户访谈' : 'Interview'}</SelectOption>
      </Select><Button disabled={busy || processing || !discussion.canonicalTranscript} onClick={() => void operation(() => fetchJson(apiUrl(`${base}/organize`), { method: 'POST', body: JSON.stringify({ template }) }))}><RefreshCw className="size-3.5" />{zh ? '重新整理' : 'Regenerate'}</Button></div>
    </header>
    <nav aria-label={zh ? '会议内容' : 'Meeting content'} className="flex shrink-0 items-center gap-4 border-b border-edge-subtle px-4 py-2 text-sm">
      {(['summary', 'transcript'] as const).map(value => <button key={value} className={tab === value ? 'font-medium text-accent-fg' : 'text-fg-muted'} onClick={() => setTab(value)}>{value === 'summary' ? (zh ? '纪要与行动' : 'Summary & actions') : (zh ? '逐字稿' : 'Transcript')}</button>)}
      <div className="ml-auto flex items-center gap-2 text-xs"><Download className="size-3" />{['md','txt','srt'].map(format => <a key={format} className="text-accent-fg" href={apiUrl(`${base}/export?format=${format}`)} download>{format.toUpperCase()}</a>)}</div>
    </nav>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-subtle px-4 py-2">
      <PageContextCaptureButton resource={{ kind: 'note', id: noteId, revision: String(detail.note.remoteVersion ?? 1) }}
        selection={{ text: pageText, draft: false }} label={zh ? '引用当前会议内容到新对话' : 'Reference displayed meeting content'}
        disabled={busy || processing || Boolean(edit || editing) || !pageText || pageText.length > 16000} />
      <p className="text-xs text-fg-muted">{pageText.length > 16000
        ? (zh ? '内容超过 16,000 字符，请筛选更少的逐字稿内容后重试。' : 'Over 16,000 characters. Filter fewer transcript segments and try again.')
        : (zh ? '仅附带当前纪要或已加载的筛选逐字稿，不含录音；作为用户提供的文本。' : 'Includes this summary or loaded filtered transcript only, not audio; treated as user-provided text.')}</p>
    </div>
    {error ? <p role="alert" className="px-4 py-2 text-sm text-danger">{error}</p> : null}
    {detail.recordingJob?.state === 'queued' || detail.recordingJob?.state === 'running' ? <p role="status" className="px-4 py-2 text-sm text-fg-muted">{zh ? '录音已上传，正在后台校验与保存。关闭此页面不会中断处理。' : 'Recording uploaded. Verification and saving continue in the background, even if you close this page.'}</p> : null}
    {discussion.status === 'needs_attention' ? <div className="flex gap-2 p-4 text-sm text-danger"><span>{discussion.failureMessage}</span><button disabled={busy} onClick={() => void operation(() => retryDiscussion(discussion.id))}>{zh ? '重试' : 'Retry'}</button></div> : null}
    {record && record.transcriptRevision !== transcript.revision ? <p className="px-4 py-2 text-xs text-fg-muted">{zh ? '转写已修改，当前纪要引用的是修改前版本。重新整理可生成新版纪要。' : 'Transcript changed. This summary cites the previous revision; regenerate to update.'}</p> : null}
    <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      {tab === 'summary' ? organization ? <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between text-xs text-fg-muted"><span>{organization.summaryEditedByUser ? (zh ? '概要已人工编辑' : 'Overview edited') : ''}</span><button disabled={busy || processing} onClick={() => setEdit({ kind: 'summary', itemId: 'summary', text: organization.summary })}>{zh ? '编辑概要' : 'Edit overview'}</button></div>
        <p className="whitespace-pre-wrap text-sm leading-7">{organization.summary}</p>
        <label className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" className="ui-checkbox" checked={showIgnored} onChange={event => setShowIgnored(event.target.checked)} />{zh ? '显示已忽略项' : 'Show ignored items'}</label>
        {selected.length ? <Button disabled={busy} onClick={() => void operation(async () => {
          for (const actionId of selected) await fetchJson(apiUrl(`${base}/actions/${encodeURIComponent(actionId)}/convert`), { method: 'POST', body: JSON.stringify({ organizationRevision: record.revision }) });
          setSelected([]);
        })}>{zh ? `加入所选 ${selected.length} 项任务` : `Add ${selected.length} selected tasks`}</Button> : null}
        {facts(zh ? '已决定事项' : 'Decisions', organization.decisions, 'decisions')}
        {organization.actionItems.length ? <section className="space-y-3"><h3 className="font-semibold">{zh ? '下一步行动' : 'Next actions'}</h3>{organization.actionItems.filter(item => showIgnored || !item.ignored).map(item => {
          const task = tasks.find(candidate => candidate.actionId === item.id);
          return <article key={item.id} className="rounded-lg border border-edge-subtle p-3"><div className="flex items-start gap-2">{!task && !item.ignored && (!(item.supersededBy || item.disputedBy) || item.reviewedChangeId === (item.supersededBy ?? item.disputedBy)) ? <input type="checkbox" aria-label={`${zh ? '选择行动' : 'Select action'}: ${item.title}`} className="ui-checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} /> : null}<p className="flex-1 text-sm font-medium">{item.title}{item.supersededBy || item.disputedBy ? <span className="ml-2 text-xs text-fg-muted">{zh ? '有后续变更，请复核' : 'Review later changes'}</span> : null}{item.editedByUser ? <span className="ml-2 text-xs text-fg-muted">{zh ? (item.ignored ? '已忽略' : '人工编辑') : (item.ignored ? 'Ignored' : 'Edited')}</span> : null}</p><button className="text-xs text-fg-muted" disabled={busy || processing} onClick={() => setEdit({ kind: 'actionItems', itemId: item.id, text: item.title, owner: item.owner, dueDate: item.dueDate, ignored: item.ignored })}>{zh ? '编辑' : 'Edit'}</button></div><p className="mt-1 text-xs text-fg-muted">{item.owner ?? (zh ? '负责人未明确' : 'Owner unspecified')} · {item.dueDate ?? (zh ? '期限未明确' : 'Date unspecified')}</p><div className="mt-3 flex flex-wrap items-center gap-3 text-xs">{item.evidenceSegmentIds.length ? <button disabled={busy} className="text-accent-fg" onClick={() => void cite(item.evidenceSegmentIds, item.evidenceRevision)}>{zh ? '查看原话' : 'Source'}</button> : null}{task ? task.deleted ? <span>{zh ? '关联任务已删除' : 'Linked task deleted'}</span> : <Link className="text-accent-fg" to={`/tasks/${encodeURIComponent(task.taskId)}`}>{task.resolution === 'done' ? (zh ? '已完成 · 查看任务' : 'Done · View task') : (zh ? '查看任务 / 交给助手' : 'View task / Delegate')}</Link> : item.ignored ? null : <Button disabled={busy || (Boolean(item.supersededBy || item.disputedBy) && item.reviewedChangeId !== (item.supersededBy ?? item.disputedBy))} onClick={() => void operation(() => fetchJson(apiUrl(`${base}/actions/${encodeURIComponent(item.id)}/convert`), { method: 'POST', body: JSON.stringify({ organizationRevision: record.revision }) }))}>{zh ? '加入我的任务' : 'Add to my tasks'}</Button>}</div></article>;
        })}</section> : null}
        {facts(zh ? '风险' : 'Risks', organization.risks, 'risks')}{facts(zh ? '尚未确定' : 'Open questions', organization.openQuestions, 'openQuestions')}
        {organization.changes?.length ? <section className="space-y-3"><h3 className="font-semibold">{zh ? '前后变更' : 'Changes during the meeting'}</h3>{organization.changes.map(change => {
          const all = [...organization.decisions, ...organization.actionItems, ...organization.risks, ...organization.openQuestions];
          const before = all.find(item => item.id === change.fromId); const after = all.find(item => item.id === change.toId);
          if (!before || !after) return null;
          return <article key={`${change.fromId}:${change.toId}`} className="space-y-2 rounded border border-edge p-3 text-sm"><p className="text-xs text-fg-muted">{change.relation === 'supersedes' ? (zh ? '后续撤销或替代' : 'Later superseded') : (zh ? '存在冲突，尚未明确解决' : 'Unresolved conflict')}</p><button className="block text-left text-accent-fg" onClick={() => void cite(before.evidenceSegmentIds, before.evidenceRevision)}>{'title' in before ? before.title : before.text}</button><span>↓</span><button className="block text-left text-accent-fg" onClick={() => void cite(after.evidenceSegmentIds, after.evidenceRevision)}>{'title' in after ? after.title : after.text}</button></article>;
        })}</section> : null}
        {organization.chapters.length ? <section className="space-y-3"><h3 className="font-semibold">{zh ? '章节回顾' : 'Chapters'}</h3>{organization.chapters.map((chapter, index) => <div key={index}><button className="text-sm text-accent-fg" onClick={() => seek(chapter.startedAtMs)}>{clock(chapter.startedAtMs)} · {chapter.title}</button><p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{chapter.summary}</p></div>)}</section> : null}
      </div> : <div className="space-y-3"><p className="text-sm text-fg-muted">{processing ? (zh ? '录音已保存，纪要正在生成。可以先查看逐字稿。' : 'Recording saved. Summary is processing; you can read the transcript.') : (zh ? '录音结束后自动生成纪要。' : 'Summary appears after recording ends.')}</p>{processing ? <><Skeleton className="h-6 w-3/4" /><Skeleton className="h-24 w-full" /></> : null}</div>
      : <div className="space-y-4"><label className="flex items-center gap-2 rounded-md border border-edge px-3"><Search className="size-4 text-fg-muted" /><input className="w-full bg-transparent py-2 text-sm outline-none" placeholder={zh ? '查找原话或说话人' : 'Search words or speaker'} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>{filtered.slice(0, page * 50).map(segment => <article key={segment.sequence} className={`rounded-md border p-3 ${playingAt >= segment.startedAtMs && playingAt < segment.endedAtMs ? 'border-accent' : 'border-edge-subtle'}`}>
        <div className="mb-2 flex items-center gap-3 text-xs text-fg-muted"><button className="inline-flex items-center gap-1 text-accent-fg" onClick={() => seek(segment.startedAtMs)}><Play className="size-3" />{clock(segment.startedAtMs)}</button><span>{segment.speakerLabel ?? (zh ? '未区分说话人' : 'Speaker unknown')}</span>{editable && segment.status === 'confirmed' ? <button className="ml-auto" onClick={() => setEditing({ segment, text: segment.displayText ?? segment.rawText ?? '', speaker: segment.speakerLabel ?? '' })}>{zh ? '校对' : 'Edit'}</button> : null}</div>
        <p className="whitespace-pre-wrap text-sm leading-6">{segment.displayText ?? segment.rawText ?? (zh ? '等待转写' : 'Awaiting transcription')}</p>
      </article>)}{filtered.length > page * 50 ? <Button onClick={() => setPage(page + 1)}>{zh ? '加载更多' : 'More'}</Button> : null}</div>}
    </main>
    {discussion.audioAttachmentId && !discussion.audioDeletedAt ? <footer className="shrink-0 border-t border-edge-subtle p-3"><audio ref={audio} controls preload="metadata" className="h-10 w-full" src={apiUrl(`${base}/audio`)} onTimeUpdate={() => setPlayingAt((audio.current?.currentTime ?? 0) * 1000)} onLoadedMetadata={() => { if (pendingSeek.current !== null && audio.current) { audio.current.currentTime = pendingSeek.current; pendingSeek.current = null; } }} onError={() => setError(zh ? '录音暂不可播放' : 'Recording unavailable')} /><a className="mt-1 block text-right text-xs text-accent-fg" href={apiUrl(`${base}/audio`)} download>{zh ? '下载录音' : 'Download recording'}</a></footer> : null}
    {evidence ? <aside aria-label={zh ? '原话证据' : 'Source evidence'} className="absolute inset-y-0 right-0 z-10 flex w-[min(26rem,100%)] flex-col border-l border-edge bg-surface-panel"><header className="flex shrink-0 items-center justify-between border-b border-edge p-4"><h3>{zh ? '原话证据' : 'Source evidence'}</h3><button aria-label={zh ? '关闭' : 'Close'} onClick={() => setEvidence(null)}><X className="size-4" /></button></header><div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{evidence.length ? evidence.map(segment => <article key={segment.sequence}><button className="mb-2 text-xs text-accent-fg" onClick={() => seek(segment.startedAtMs)}>{clock(segment.startedAtMs)} · {segment.speakerLabel ?? (zh ? '说话人未明确' : 'Unknown speaker')}</button><p className="whitespace-pre-wrap text-sm leading-7">{segment.displayText ?? segment.rawText}</p></article>) : <p>{zh ? '此版本暂无可定位原话。' : 'No timed source available for this revision.'}</p>}</div></aside> : null}
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
