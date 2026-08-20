import * as Dialog from '@radix-ui/react-dialog';
import { RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { TimePicker } from '@/components/ui/time-picker';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { formatDreamingSchedule } from './dreaming-schedule-format';
import type { DreamingSchedule, DreamingSettings } from './user-context-api';

type Phase = keyof DreamingSettings['phases'];
type PhaseSettings = DreamingSettings['phases'][Phase];

const DEFAULT_SCHEDULES: Record<Phase, DreamingSchedule> = {
  light: { kind: 'interval', everyHours: 6, minute: 0 },
  deep: { kind: 'daily', time: '03:00' },
  rem: { kind: 'weekly', weekday: 0, time: '05:00' },
};

const INTERVALS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

export function DreamingScheduleDialog({
  open,
  phase,
  value,
  language,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  phase: Phase;
  value: PhaseSettings;
  language: 'en' | 'zh';
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: PhaseSettings) => Promise<void>;
}) {
  const zh = language === 'zh';
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const setKind = (kind: DreamingSchedule['kind']) => {
    const current = draft.schedule;
    const time = current.kind === 'daily' || current.kind === 'weekly' ? current.time : '03:00';
    const schedule: DreamingSchedule = kind === 'interval'
      ? { kind, everyHours: 6, minute: 0 }
      : kind === 'daily'
        ? { kind, time }
        : { kind, weekday: 0, time };
    setDraft({ ...draft, schedule });
  };

  const updateInterval = (patch: Partial<Extract<DreamingSchedule, { kind: 'interval' }>>) => {
    if (draft.schedule.kind !== 'interval') return;
    setDraft({ ...draft, schedule: { ...draft.schedule, ...patch } });
  };

  const updateWeekly = (patch: Partial<Extract<DreamingSchedule, { kind: 'weekly' }>>) => {
    if (draft.schedule.kind !== 'weekly') return;
    setDraft({ ...draft, schedule: { ...draft.schedule, ...patch } });
  };

  const updateTime = (time: string) => {
    if (draft.schedule.kind === 'interval') return;
    setDraft({ ...draft, schedule: { ...draft.schedule, time } });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim backdrop-blur-[1px]', SETTINGS_SHELL_OVERLAY_Z)} />
        <Dialog.Content className={cn(
          'fixed left-1/2 top-1/2 flex h-[min(38rem,calc(100dvh-1.5rem))] w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
          SETTINGS_SHELL_CONTENT_Z,
          'rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none',
        )}>
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">
                {phase.toUpperCase()} · {zh ? '运行计划' : 'Schedule'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">
                {zh ? '设置后台记忆整理的频率和时间。' : 'Choose when background memory consolidation runs.'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild><Button variant="ghost" className="size-9 shrink-0 p-0" aria-label={zh ? '关闭' : 'Close'}><X className="size-4" /></Button></Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-edge-subtle bg-surface-subtle px-4 py-3">
              <div><p className="text-sm font-medium text-fg">{zh ? '自动运行' : 'Automatic runs'}</p><p className="mt-0.5 text-xs text-fg-muted">{zh ? '关闭后仍可手动立即运行。' : 'You can still run this phase manually.'}</p></div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.enabled}
                className={cn('relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors', draft.enabled ? 'bg-accent' : 'bg-surface-active')}
                onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
              ><span className={cn('absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform', draft.enabled && 'translate-x-5')} /></button>
            </div>

            <label className="block space-y-2 text-sm font-medium text-fg">
              <span>{zh ? '运行频率' : 'Frequency'}</span>
              <Select value={draft.schedule.kind} onChange={(event) => setKind(event.target.value as DreamingSchedule['kind'])}>
                <SelectOption value="interval">{zh ? '每隔几小时' : 'Every few hours'}</SelectOption>
                <SelectOption value="daily">{zh ? '每天' : 'Daily'}</SelectOption>
                <SelectOption value="weekly">{zh ? '每周' : 'Weekly'}</SelectOption>
              </Select>
            </label>

            {draft.schedule.kind === 'interval' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 text-sm font-medium text-fg"><span>{zh ? '间隔' : 'Interval'}</span><Select value={String(draft.schedule.everyHours)} onChange={(event) => updateInterval({ everyHours: Number(event.target.value) as typeof draft.schedule.everyHours })}>{INTERVALS.map((hours) => <SelectOption key={hours} value={String(hours)}>{zh ? `${hours} 小时` : `${hours} hours`}</SelectOption>)}</Select></label>
                <label className="block space-y-2 text-sm font-medium text-fg"><span>{zh ? '开始分钟' : 'Minute'}</span><Select value={String(draft.schedule.minute)} onChange={(event) => updateInterval({ minute: Number(event.target.value) })}>{[0, 15, 30, 45].map((minute) => <SelectOption key={minute} value={String(minute)}>{String(minute).padStart(2, '0')}</SelectOption>)}</Select></label>
              </div>
            ) : null}

            {draft.schedule.kind === 'weekly' ? (
              <label className="block space-y-2 text-sm font-medium text-fg"><span>{zh ? '星期' : 'Weekday'}</span><Select value={String(draft.schedule.weekday)} onChange={(event) => updateWeekly({ weekday: Number(event.target.value) })}>{(zh ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']).map((label, weekday) => <SelectOption key={label} value={String(weekday)}>{label}</SelectOption>)}</Select></label>
            ) : null}

            {draft.schedule.kind === 'daily' || draft.schedule.kind === 'weekly' ? (
              <label className="block space-y-2 text-sm font-medium text-fg"><span>{zh ? '运行时间' : 'Run time'}</span><TimePicker value={draft.schedule.time} minuteStep={15} ariaLabel={zh ? '运行时间' : 'Run time'} onChange={updateTime} /></label>
            ) : null}

            <div className="rounded-xl bg-accent-soft px-4 py-3"><p className="text-xs font-medium text-accent-fg">{zh ? '计划预览' : 'Schedule preview'}</p><p className="mt-1 text-sm text-fg">{formatDreamingSchedule(draft.schedule, language)}</p></div>
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-edge px-5 py-4">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setDraft({ enabled: true, schedule: DEFAULT_SCHEDULES[phase] })}><RotateCcw className="size-4" />{zh ? '恢复推荐值' : 'Restore recommended'}</Button>
            <div className="flex gap-2"><Dialog.Close asChild><Button type="button" variant="ghost" disabled={saving}>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close><Button type="button" variant="primary" disabled={saving} onClick={() => void onSave(draft)}>{saving ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}</Button></div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
