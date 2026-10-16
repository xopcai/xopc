import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import type { DiscussionAnnotation, DiscussionEvidence, DiscussionPlaybackRange, DiscussionResolvedAnnotation } from '@xopcai/gateway-contract';
import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { acknowledgeLocalAnnotation, listLocalAnnotations, saveLocalAnnotation, type LocalDiscussionAnnotation } from './discussion-annotation-store';
import { syncDiscussionAnnotations } from './discussion-annotation-sync';

export function DiscussionAnnotations({ recordingId,discussionId,zh,onEvidence,onPlay }: {
  recordingId: string; discussionId: string; zh: boolean; onEvidence: (value: DiscussionEvidence) => void; onPlay: (range: DiscussionPlaybackRange) => void;
}) {
  const { data: remote = [],mutate } = useSWR<DiscussionResolvedAnnotation[]>(`/api/discussions/${discussionId}/annotations`,(path: string) => fetchJson<DiscussionResolvedAnnotation[]>(apiUrl(path)));
  const [local,setLocal] = useState<LocalDiscussionAnnotation[]>([]);
  const [editingNonce,setEditingNonce] = useState<string | null>(null);
  const [editing,setEditing] = useState<DiscussionAnnotation | null>(null);
  const [error,setError] = useState('');
  const refresh = useCallback(async () => { setLocal(await listLocalAnnotations(recordingId)); },[recordingId]);
  const sync = useCallback(async () => {
    try { await syncDiscussionAnnotations(recordingId,discussionId); await refresh(); await mutate(); }
    catch (error) { await mutate(); setError(error instanceof Error ? error.message : String(error)); }
  },[recordingId,discussionId,refresh,mutate]);
  useEffect(() => {
    void refresh().catch(error => setError(String(error))); void sync();
    const changed = () => { void refresh().catch(error => setError(String(error))); };
    window.addEventListener('discussion-annotations-changed',changed); window.addEventListener('online',sync);
    const timer = window.setInterval(() => { if (navigator.onLine) void sync(); },15_000);
    return () => { window.removeEventListener('discussion-annotations-changed',changed); window.removeEventListener('online',sync); window.clearInterval(timer); };
  },[refresh,sync]);
  const all = new Map(remote.map(row => [row.annotation.id,{ ...row,localState: 'synced' }]));
  for (const row of local) if (row.state !== 'synced' || !all.has(row.annotation.id)) {
    const previous = all.get(row.annotation.id);
    all.set(row.annotation.id,{ annotation: row.annotation, state: previous?.state ?? 'pending', playback: previous?.playback ?? [], evidence: previous?.evidence, localState: row.state });
  }
  const save = async (annotation: DiscussionAnnotation,nonce = local.find(row => row.annotation.id === annotation.id)?.nonce ?? null) => {
    try { await saveLocalAnnotation(recordingId,{ ...annotation,updatedAt: Date.now() },nonce); setEditing(null); setError(''); await refresh(); void sync(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <section className="space-y-4" aria-label={zh ? '我的标记' : 'My highlights'}>
    {error ? <p role="alert" className="text-sm text-danger">{error}<Button onClick={() => void sync()}>{zh ? '重试同步' : 'Retry sync'}</Button></p> : null}
    {!all.size ? <p className="text-sm text-fg-muted">{zh ? '录音时标重点，或在原文中标记整段。标记先保存在本机。' : 'Highlight while recording or mark a transcript segment. Highlights save locally first.'}</p> : null}
    {[...all.values()].sort((left,right) => left.annotation.anchor.capturedAt - right.annotation.anchor.capturedAt).filter(row => !row.annotation.deleted || row.localState === 'conflict').map(row => <article key={row.annotation.id} className="space-y-2 rounded-lg border border-edge p-3">
      <p className="text-xs text-fg-muted">{row.annotation.kind === 'highlight' ? (zh ? '重点' : 'Highlight') : row.annotation.kind === 'question' ? (zh ? '问题' : 'Question') : (zh ? '我的补充' : 'My note')} · {new Date(row.annotation.anchor.capturedAt).toLocaleString()} · {row.localState === 'synced' ? (zh ? '已同步' : 'Synced') : row.localState === 'conflict' ? (zh ? '同步冲突，保留了本机修改' : 'Conflict; local edits retained') : (zh ? '本机已保存，待同步' : 'Saved locally; sync pending')}</p>
      {row.evidence?.segments.map(segment => <blockquote key={segment.sequence} className="text-sm">{segment.text}</blockquote>)}
      {row.positionMs !== undefined ? <p className="text-xs text-fg-muted">{zh ? '标记位置' : 'Marked position'} · {Math.floor(row.positionMs / 60000)}:{String(Math.floor(row.positionMs / 1000) % 60).padStart(2,'0')}</p> : null}
      {row.annotation.text ? <p className="whitespace-pre-wrap text-sm">{zh ? '我的说明：' : 'My context: '}{row.annotation.text}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!row.evidence} onClick={() => row.evidence && onEvidence(row.evidence)}>{zh ? '查看原文' : 'View transcript'}</Button>
        {row.playback.map((range,index) => <Button key={index} onClick={() => onPlay(range)}>{zh ? '回听' : 'Play'} {Math.floor(range.startedAtMs / 60000)}:{String(Math.floor(range.startedAtMs / 1000) % 60).padStart(2,'0')}</Button>)}
        <Button onClick={() => { setEditingNonce(local.find(item => item.annotation.id === row.annotation.id)?.nonce ?? null); setEditing({ ...row.annotation,revision: remote.find(item => item.annotation.id === row.annotation.id)?.annotation.revision ?? row.annotation.revision }); }}>{row.localState === 'conflict' ? (zh ? '合并修改' : 'Merge changes') : (zh ? '添加说明／类型' : 'Edit context/type')}</Button>
        <Button onClick={() => void save({ ...row.annotation,deleted: true })}>{zh ? '移除标记' : 'Remove'}</Button>
      </div>
      {row.state === 'located' && !row.evidence ? <p className="text-xs text-fg-muted">{zh ? '该位置原文尚未生成，可先回听原音。' : 'Transcript for this position is pending; audio is usable.'}</p> : null}
      {row.state === 'unavailable' ? <p className="text-xs text-fg-muted">{zh ? '该位置原音未保存、已删除或时间尚无法核实；保留原始标记，不自动移动。' : 'Audio at this position is missing, deleted or unverified. The original anchor has been retained.'}</p> : row.state === 'pending' ? <p className="text-xs text-fg-muted">{zh ? '等待原音／原文完成定位' : 'Awaiting audio/transcript positioning'}</p> : null}
      {row.localState === 'conflict' ? <Button onClick={() => {
        const localRow = local.find(item => item.annotation.id === row.annotation.id); const server = remote.find(item => item.annotation.id === row.annotation.id);
        if (localRow && server) void acknowledgeLocalAnnotation(localRow,server.annotation).then(refresh);
      }}>{zh ? '使用服务端版本' : 'Use server version'}</Button> : null}
    </article>)}
    {editing ? <div role="dialog" aria-label={zh ? '编辑标记' : 'Edit highlight'} className="rounded-lg border border-edge p-3">
      <Select value={editing.kind} aria-label={zh ? '标记类型' : 'Highlight type'} onChange={event => setEditing({ ...editing,kind: event.target.value as DiscussionAnnotation['kind'] })}><SelectOption value="highlight">{zh ? '重点' : 'Highlight'}</SelectOption><SelectOption value="question">{zh ? '问题' : 'Question'}</SelectOption><SelectOption value="note">{zh ? '补充' : 'Context'}</SelectOption></Select>
      <textarea aria-label={zh ? '我的说明' : 'My context'} maxLength={4000} value={editing.text} onChange={event => setEditing({ ...editing,text: event.target.value })} className="my-2 min-h-24 w-full rounded border border-edge bg-surface-inset p-2" />
      <Button onClick={() => void save(editing,editingNonce)}>{zh ? '保存到本机并同步' : 'Save locally and sync'}</Button><Button onClick={() => setEditing(null)}>{zh ? '取消' : 'Cancel'}</Button>
    </div> : null}
  </section>;
}
