import { useState, type FormEvent } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { sceneErrorText, sceneGet, sceneWrite, type SceneActivation, type SceneTemplate } from './api';

type Schedule = { weekdays: number[]; hour: number; minute: number; timeZone: string };
type Cursor = { triggerKey: string; revision: number; nextDueAt: number; schedule: Schedule };
const field = 'min-h-11 w-full rounded-md border border-edge bg-surface-panel px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export function ScheduleEditor({ activation, zh, onDirty, onChanged }: { activation: SceneActivation; zh: boolean; onDirty: (dirty: boolean) => void; onChanged?: () => void }) {
  const path = `/activations/${activation.id}/schedules`;
  const schedules = useSWR<{ schedules: Cursor[] }>(path, sceneGet);
  const template = useSWR<{ template: SceneTemplate }>(`/templates/${activation.templateKey}/versions/${activation.templateVersion}`, sceneGet);
  const [editing, setEditing] = useState<{ cursor?: Cursor } | null>(null);
  const [error, setError] = useState<unknown>();
  const refresh = () => { void schedules.mutate(); void template.mutate(); };
  if (schedules.error || template.error) return <div role="alert"><p>{sceneErrorText(schedules.error ?? template.error, zh)}</p><Button onClick={refresh}>{zh ? '重新加载' : 'Reload'}</Button></div>;
  if (!schedules.data || !template.data) return <Skeleton className="h-32 w-full" />;
  const trigger = template.data.template.triggers.find((item) => item.type === 'schedule');
  if (!trigger) return null;
  const cursor = schedules.data.schedules.find((item) => item.triggerKey === trigger.id);
  return <section className="space-y-3 rounded-xl border border-edge p-4 sm:p-6">
    <h2 className="text-base font-semibold text-fg">{zh ? '检查时间' : 'Review schedule'}</h2>
    {cursor ? <p className="text-sm text-fg-muted">{activation.status === 'active' ? (zh ? '下次检查：' : 'Next check: ') : (zh ? '当前不会定时检查。已保存时间：' : 'Not scheduling while inactive. Saved time: ')}{new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: cursor.schedule.timeZone }).format(cursor.nextDueAt)} · {cursor.schedule.timeZone}</p>
      : <p className="text-sm text-fg-muted">{zh ? '尚未设置定时检查。只有你点“现在检查”才会执行周期复盘。' : 'No recurring schedule yet. Use Check now for a manual review.'}</p>}
    {Boolean(error) && <p role="alert" className="text-sm text-danger">{sceneErrorText(error, zh)}</p>}
    {editing ? <ScheduleForm initial={editing.cursor} zh={zh} onCancel={() => { setEditing(null); onDirty(false); }} onSave={async (schedule) => {
      setError(undefined);
      try {
        await sceneWrite(`${path}/${encodeURIComponent(trigger.id)}`, 'PATCH', { expectedRevision: editing.cursor?.revision ?? 0, schedule });
        setEditing(null); onDirty(false); await schedules.mutate(); onChanged?.();
      } catch (reason) { setError(reason); throw reason; }
    }} /> : <Button disabled={activation.status !== 'active'} onClick={() => { setError(undefined); setEditing({ cursor }); onDirty(true); }}>{cursor ? (zh ? '修改时间' : 'Edit schedule') : (zh ? '设置时间' : 'Set schedule')}</Button>}
    <p className="text-xs text-fg-muted">{zh ? '没有值得关注的新变化时保持安静。暂停关注会停止定时检查。' : 'Stays quiet when there is no useful change. Pause the monitor to stop scheduled checks.'}</p>
  </section>;
}

function ScheduleForm({ initial, zh, onSave, onCancel }: { initial?: Cursor; zh: boolean; onSave: (schedule: Schedule) => Promise<void>; onCancel: () => void }) {
  const [weekdays, setWeekdays] = useState(initial?.schedule.weekdays ?? [0]);
  const [time, setTime] = useState(`${String(initial?.schedule.hour ?? 18).padStart(2, '0')}:${String(initial?.schedule.minute ?? 0).padStart(2, '0')}`);
  const [zone, setZone] = useState(initial?.schedule.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { setInvalid(true); return; }
    if (!weekdays.length || !/^\d{2}:\d{2}$/.test(time)) { setInvalid(true); return; }
    setInvalid(false); setBusy(true);
    try { const [hour, minute] = time.split(':').map(Number); await onSave({ weekdays, hour, minute, timeZone: zone }); }
    catch { /* The parent displays the request error without discarding this form. */ }
    finally { setBusy(false); }
  };
  const labels = zh ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return <form onSubmit={(event) => void submit(event)}><fieldset disabled={busy} className="space-y-4">
    <fieldset><legend className="mb-2 text-sm font-medium text-fg">{zh ? '每周检查日' : 'Days of the week'}</legend><div className="flex flex-wrap gap-2">{labels.map((label, day) => <label key={day} className="flex min-h-11 items-center gap-2 rounded-md border border-edge px-3 text-sm text-fg"><input type="checkbox" className="ui-checkbox" checked={weekdays.includes(day)} onChange={(event) => setWeekdays((previous) => event.target.checked ? [...previous, day].sort() : previous.filter((item) => item !== day))} />{label}</label>)}</div></fieldset>
    <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium text-fg">{zh ? '当地时间' : 'Local time'}<input type="time" required value={time} onChange={(event) => setTime(event.target.value)} className={field} /></label>
      <label className="grid gap-2 text-sm font-medium text-fg">{zh ? '时区（例如 Asia/Shanghai）' : 'Time zone (for example Asia/Shanghai)'}<input required maxLength={100} value={zone} onChange={(event) => setZone(event.target.value)} className={field} spellCheck={false} /></label></div>
    {invalid && <p role="alert" className="text-sm text-danger">{zh ? '请选择至少一天，并填写有效时间和时区。' : 'Choose at least one day and enter a valid time and time zone.'}</p>}
    <div className="flex gap-3"><Button type="submit" disabled={busy}>{busy ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存时间' : 'Save schedule')}</Button><Button type="button" onClick={onCancel}>{zh ? '取消' : 'Cancel'}</Button></div>
  </fieldset></form>;
}
