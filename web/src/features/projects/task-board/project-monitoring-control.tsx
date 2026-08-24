import * as Dialog from '@radix-ui/react-dialog';
import type { MonitoringMode, ProjectMonitoringPolicy, ProjectMonitoringUpdate } from '@xopcai/gateway-contract';
import { Settings2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';

export type ProjectMonitoringCopy = {
  title: string;
  description: string;
  mode: string;
  modes: Record<MonitoringMode, string>;
  confidence: string;
  quietHours: string;
  quietStart: string;
  quietEnd: string;
  timezone: string;
  allowTaskCreation: string;
  allowTaskCreationDescription: string;
  cancel: string;
  save: string;
  saving: string;
  saveFailed: string;
};

export function ProjectMonitoringControl({ policy, copy, onSave }: {
  policy: ProjectMonitoringPolicy;
  copy: ProjectMonitoringCopy;
  onSave: (update: ProjectMonitoringUpdate) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<MonitoringMode>(policy.mode);
  const [confidence, setConfidence] = useState(Math.round(policy.confidenceThreshold * 100));
  const [quietEnabled, setQuietEnabled] = useState(Boolean(policy.quietHours));
  const [quietStart, setQuietStart] = useState(policy.quietHours?.startHour ?? 22);
  const [quietEnd, setQuietEnd] = useState(policy.quietHours?.endHour ?? 8);
  const [timezone, setTimezone] = useState(policy.quietHours?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [allowTaskCreation, setAllowTaskCreation] = useState(policy.allowedActions.includes('create_project_task'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setMode(policy.mode);
    setConfidence(Math.round(policy.confidenceThreshold * 100));
    setQuietEnabled(Boolean(policy.quietHours));
    setQuietStart(policy.quietHours?.startHour ?? 22);
    setQuietEnd(policy.quietHours?.endHour ?? 8);
    setTimezone(policy.quietHours?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    setAllowTaskCreation(policy.allowedActions.includes('create_project_task'));
  }, [policy]);

  const submit = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await onSave({
        mode,
        confidenceThreshold: confidence / 100,
        quietHours: quietEnabled ? { startHour: quietStart, endHour: quietEnd, timezone } : null,
        allowedActions: allowTaskCreation ? ['create_project_task'] : [],
      });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="ghost" className="h-9 gap-2 px-2.5 text-xs">
          <Settings2 className="size-3.5" aria-hidden />
          {copy.modes[policy.mode]}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(36rem,calc(100vh-2rem))] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 py-4">
            <div><Dialog.Title className="text-base font-semibold text-fg">{copy.title}</Dialog.Title><Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">{copy.description}</Dialog.Description></div>
            <Dialog.Close asChild><Button type="button" variant="ghost" className="size-9 p-0" disabled={saving}><X className="size-4" aria-hidden /></Button></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <label className="grid gap-2 text-sm"><span className="font-medium text-fg-muted">{copy.mode}</span><Select value={mode} onChange={(event) => setMode(event.target.value as MonitoringMode)}>{Object.entries(copy.modes).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></label>
            <label className="grid gap-2 text-sm"><span className="font-medium text-fg-muted">{copy.confidence} · {confidence}%</span><input type="range" min="50" max="100" step="5" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} className="accent-accent" /></label>
            <div className="rounded-lg border border-edge p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-fg"><input type="checkbox" checked={quietEnabled} onChange={(event) => setQuietEnabled(event.target.checked)} />{copy.quietHours}</label>
              {quietEnabled ? <div className="mt-3 grid grid-cols-2 gap-3"><label className="grid gap-1 text-xs text-fg-muted">{copy.quietStart}<input type="number" min="0" max="23" value={quietStart} onChange={(event) => setQuietStart(Number(event.target.value))} className="rounded-lg border border-edge bg-surface-base px-3 py-2 text-fg" /></label><label className="grid gap-1 text-xs text-fg-muted">{copy.quietEnd}<input type="number" min="0" max="23" value={quietEnd} onChange={(event) => setQuietEnd(Number(event.target.value))} className="rounded-lg border border-edge bg-surface-base px-3 py-2 text-fg" /></label><label className="col-span-2 grid gap-1 text-xs text-fg-muted">{copy.timezone}<input value={timezone} onChange={(event) => setTimezone(event.target.value)} className="rounded-lg border border-edge bg-surface-base px-3 py-2 text-fg" /></label></div> : null}
            </div>
            <label className="flex items-start gap-3 rounded-lg border border-edge p-3"><input type="checkbox" className="mt-1" checked={allowTaskCreation} onChange={(event) => setAllowTaskCreation(event.target.checked)} /><span><span className="block text-sm font-medium text-fg">{copy.allowTaskCreation}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{copy.allowTaskCreationDescription}</span></span></label>
          </div>
          <div className="shrink-0 border-t border-edge px-5 py-3">{error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}<div className="flex justify-end gap-2"><Dialog.Close asChild><Button type="button" variant="ghost" disabled={saving}>{copy.cancel}</Button></Dialog.Close><Button type="button" variant="primary" disabled={saving || !timezone.trim() || quietStart < 0 || quietStart > 23 || quietEnd < 0 || quietEnd > 23} onClick={() => void submit()}>{saving ? copy.saving : copy.save}</Button></div></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
