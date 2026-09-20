import { useState, type FormEvent } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { sceneErrorText, sceneGet, sceneWrite, type SceneActivation } from './api';

type WorkItem = { id: string; subjectId: string; accountId: string; dueAt: number; revision: number; status: 'watching' | 'paused' | 'completed' };

export function MailDeadlineEditor({ activation, zh, onDirty, onChanged }: { activation: SceneActivation; zh: boolean; onDirty: (dirty: boolean) => void; onChanged: () => void }) {
  const path = `/activations/${activation.id}/work-items`;
  const items = useSWR<{ workItems: WorkItem[] }>(path, sceneGet);
  const [editing, setEditing] = useState<{ item?: WorkItem } | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const finish = () => { setEditing(null); onDirty(false); void items.mutate(); onChanged(); };
  if (items.error) return <p role="alert" className="text-sm text-danger">{sceneErrorText(items.error, zh)}<Button onClick={() => void items.mutate()}>{zh ? '重新加载' : 'Reload'}</Button></p>;
  if (!items.data) return <Skeleton className="h-32 w-full" />;
  const item = items.data.workItems[0];
  const changeStatus = async (status: 'paused' | 'completed') => {
    if (!item) return;
    setBusy(true); setError(undefined);
    try { await sceneWrite(`/work-items/${item.id}`, 'PATCH', { expectedRevision: item.revision, status }); finish(); }
    catch (reason) { setError(reason); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 rounded-xl border border-edge p-4 sm:p-6"><h2 className="text-base font-semibold text-fg">{zh ? '这封邮件的跟进时间' : 'Follow-up deadline'}</h2>
    <p className="text-sm text-fg-muted">{item ? `${item.status === 'watching' ? (zh ? '留意回复，到时检查' : 'Watching replies; check at deadline') : item.status === 'paused' ? (zh ? '已暂停跟进' : 'Follow-up paused') : (zh ? '已结束跟进' : 'Follow-up ended')} · ${new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(item.dueAt)}` : (zh ? '设置一个时间；此前有新回复时会重新判断是否还需要跟进。' : 'Choose a deadline. New replies before then trigger a review of whether follow-up is still needed.')}</p>
    {Boolean(error) && <p role="alert" className="text-sm text-danger">{sceneErrorText(error, zh)}</p>}
    {editing ? <DeadlineForm initial={editing.item?.dueAt} zh={zh} onCancel={() => { setEditing(null); onDirty(false); }} onSave={async (dueAt) => {
      setError(undefined);
      try {
        if (editing.item) await sceneWrite(`/work-items/${editing.item.id}`, 'PATCH', { expectedRevision: editing.item.revision, dueAt, status: 'watching' });
        else if (activation.scope.kind === 'objects') await sceneWrite(path, 'POST', { subjectId: activation.scope.ids[0], accountId: activation.permissions.accountIds[0], dueAt });
        finish();
      } catch (reason) { setError(reason); throw reason; }
    }} /> : <div className="flex flex-wrap gap-2">{item?.status !== 'completed' && <Button disabled={busy || activation.status !== 'active'} onClick={() => { setEditing({ item }); onDirty(true); setError(undefined); }}>{item ? (zh ? '重新设置跟进时间' : 'Reschedule follow-up') : (zh ? '设置跟进时间' : 'Set deadline')}</Button>}
      {item?.status === 'watching' && <Button disabled={busy} onClick={() => void changeStatus('paused')}>{zh ? '暂停这次跟进' : 'Pause follow-up'}</Button>}
      {item && item.status !== 'completed' && <Button disabled={busy} onClick={() => void changeStatus('completed')}>{zh ? '结束这次跟进' : 'End follow-up'}</Button>}</div>}
    <p className="text-xs text-fg-muted">{zh ? '结束跟进只停止检查，不表示邮件已发送或事情已经解决。' : 'Ending stops checks; it does not mean a message was sent or the matter resolved.'}</p>
  </section>;
}

function DeadlineForm({ initial, zh, onSave, onCancel }: { initial?: number; zh: boolean; onSave: (dueAt: number) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(() => {
    if (!initial) return '';
    const date = new Date(initial);
    return new Date(initial - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const dueAt = new Date(value).getTime();
    if (!Number.isFinite(dueAt) || dueAt <= Date.now()) { setInvalid(true); return; }
    setInvalid(false); setBusy(true);
    try { await onSave(dueAt); } catch { /* Parent displays the error; retain the entered deadline. */ }
    finally { setBusy(false); }
  };
  return <form onSubmit={(event) => void submit(event)}><fieldset disabled={busy} className="space-y-3"><label className="grid gap-2 text-sm font-medium text-fg">{zh ? '跟进时间（当前设备时区）' : 'Deadline (device time zone)'}<input required type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} className="min-h-11 w-full min-w-0 rounded-md border border-edge bg-surface-panel px-3 py-2 text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" /></label>
    {invalid && <p role="alert" className="text-sm text-danger">{zh ? '请选择未来的有效时间。' : 'Choose a valid future time.'}</p>}
    <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存跟进时间' : 'Save deadline')}</Button><Button type="button" onClick={onCancel}>{zh ? '取消' : 'Cancel'}</Button></div>
  </fieldset></form>;
}
