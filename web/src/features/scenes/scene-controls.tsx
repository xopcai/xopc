import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import type { ScenePreferences } from '../../../../src/scenes/preferences';
import { BrowserReminders } from './browser-reminders';
import { sceneErrorText, sceneGet, sceneWrite } from './api';

export function SceneControlsDialog({ zh, open, onOpenChange, onCloseAutoFocus }: {
  zh: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: () => void;
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
      <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(40rem,calc(100dvh-2rem))] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-float focus:outline-none"
        onCloseAutoFocus={event => { event.preventDefault(); onCloseAutoFocus(); }}>
        <div className="shrink-0 border-b border-edge p-4 sm:px-6">
          <Dialog.Title className="text-base font-semibold text-fg">{zh ? '检查与提醒设置' : 'Checks and reminders'}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">{zh ? '适用于所有智能关注，设置更改后自动保存。' : 'Applies to all monitors. Changes are saved automatically.'}</Dialog.Description>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"><SceneControls zh={zh} /></div>
        <div className="flex shrink-0 justify-end border-t border-edge p-4 sm:px-6">
          <Dialog.Close asChild><Button type="button" variant="secondary">{zh ? '关闭' : 'Close'}</Button></Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function SceneControls({ zh }: { zh: boolean }) {
  const preferences = useSWR<ScenePreferences & { revision: number }>('/preferences', sceneGet);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function update(patch: Partial<ScenePreferences>, expectedRevision = preferences.data?.revision): Promise<boolean> {
    if (!preferences.data || busy || expectedRevision === undefined) return false;
    setBusy(true); setError(undefined);
    try {
      const next = await sceneWrite<ScenePreferences & { revision: number }>('/preferences', 'PATCH', { ...patch, expectedRevision });
      await preferences.mutate(next, false);
      return true;
    } catch (cause) { setError(cause); await preferences.mutate(); return false; }
    finally { setBusy(false); }
  }
  if (!preferences.data) return preferences.error
    ? <p role="alert">{sceneErrorText(preferences.error, zh)}</p> : <Skeleton className="h-32 w-full" />;
  const data = preferences.data;
  const field = 'w-24 rounded-md border border-edge bg-surface-panel px-2 py-1 text-fg';
  return <div className="space-y-4 text-sm">
      <p className="text-fg-muted">{zh ? '设备休眠或服务关闭时不会检查；服务恢复后继续。草稿不会自动发送。' : 'Checks require the device and Gateway to stay running. Drafts are never sent automatically.'}</p>
      {([
        ['checksPaused', zh ? '暂停所有检查' : 'Pause all checks'],
        ['notificationsMuted', zh ? '静音提醒（继续检查并保留成果）' : 'Mute reminders (continue checks and keep results)'],
        ['suppressWhileViewing', zh ? '查看成果时不重复提醒' : 'Avoid reminders while viewing a result'],
        ['digestEnabled', zh ? '汇总为每日摘要' : 'Use a daily digest'],
      ] as const).map(([key, label]) => <label key={key} className="flex flex-wrap items-center gap-2"><input type="checkbox" checked={data[key]} disabled={busy} onChange={e => void update({ [key]: e.target.checked })} />{label}</label>)}
      <label className="flex flex-wrap items-center gap-2">{zh ? '时区' : 'Timezone'}<PreferenceInput value={data.timezone} revision={data.revision} disabled={busy} className={`${field} w-48`} zh={zh} onSave={(value, revision) => update({ timezone: String(value) }, revision)} /></label>
      {([
        ['quietStartHour', zh ? '免打扰开始（小时）' : 'Quiet hours start', 23],
        ['quietEndHour', zh ? '免打扰结束（小时）' : 'Quiet hours end', 23],
        ['dailyNotificationLimit', zh ? '每日提醒上限' : 'Daily reminder limit', 30],
        ...(data.digestEnabled ? [['digestHour', zh ? '摘要时间（小时）' : 'Digest hour', 23], ['digestMinute', zh ? '摘要时间（分钟）' : 'Digest minute', 59]] as const : []),
      ] as const).map(([key, label, max]) => <label key={key} className="flex flex-wrap items-center gap-2">{label}<PreferenceInput value={data[key]} revision={data.revision} max={max} disabled={busy} className={field} zh={zh} onSave={(value, revision) => update({ [key]: Number(value) }, revision)} /></label>)}
      <label className="flex flex-wrap items-center gap-2"><input type="checkbox" disabled={busy} checked={data.preferredChannel === 'browser'} onChange={e => void update({ preferredChannel: e.target.checked ? 'browser' : 'in_app' })} />{zh ? '允许浏览器后台提醒' : 'Allow background browser reminders'}</label>
      <BrowserReminders zh={zh} />
      {error != null && <p role="alert" className="text-danger">{sceneErrorText(error, zh)}</p>}
      {data.checksPausedUntil && <Button disabled={busy} onClick={() => void update({ checksPausedUntil: null })}>{zh ? '取消定时暂停' : 'Clear timed pause'}</Button>}
  </div>;
}

function PreferenceInput({ value, revision, max, disabled, className, zh, onSave }: {
  value: string | number; revision: number; max?: number; disabled: boolean; className: string; zh: boolean;
  onSave: (value: string | number, revision: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<{ value: string; revision: number } | null>(null);
  const save = async () => {
    if (!draft || draft.value === String(value)) return;
    const next = max === undefined ? draft.value : Number(draft.value);
    if (!draft.value || (typeof next === 'number' && (!Number.isInteger(next) || next < 0 || next > max!))) return;
    if (await onSave(next, draft.revision)) setDraft(null);
  };
  return <><input type={max === undefined ? 'text' : 'number'} min={max === undefined ? undefined : 0} max={max}
    value={draft?.value ?? value} disabled={disabled} className={className}
    onChange={event => setDraft(previous => ({ value: event.target.value, revision: previous?.revision ?? revision }))}
    onKeyDown={event => { if (event.key === 'Escape') setDraft(null); }} onBlur={event => {
      if (!(event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute('data-discard-preference'))) void save();
    }} />
    {draft && <Button data-discard-preference type="button" variant="ghost" disabled={disabled} onPointerDown={event => event.preventDefault()} onClick={() => setDraft(null)}>{zh ? '放弃修改' : 'Discard edits'}</Button>}
  </>;
}
