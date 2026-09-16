import type { Dispatch, SetStateAction } from 'react';

import { Select, SelectOption } from '@/components/ui/popover-select';
import { TimePicker } from '@/components/ui/time-picker';
import type { Project } from '@/features/projects/api';
import type { MessageBundle } from '@/i18n/messages';

import type { FormState, TriggerMode } from './automation-form';

const inputClass = 'w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent';

export function AutomationQuickCreate({ form, setForm, labels, projects, projectLocked, source, requiresProject }: {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  labels: MessageBundle['automations'];
  projects: Project[];
  projectLocked: boolean;
  source: string;
  requiresProject?: boolean;
}) {
  const update = (patch: Partial<FormState>) => setForm((previous) => ({ ...previous, ...patch }));
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
      <p className="text-sm text-fg-muted">{labels.experience.source}: {source}</p>
      <label className="grid gap-2 text-sm text-fg">{labels.form.name}
        <input className={inputClass} value={form.name} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <label className="grid gap-2 text-sm text-fg">{labels.info.task}
        <textarea className={inputClass} rows={5} value={form.instruction} onChange={(event) => update({ instruction: event.target.value })} />
      </label>
      {!projectLocked && <label className="grid gap-2 text-sm text-fg">{labels.form.project}
        <Select className={inputClass} value={form.projectId} onChange={(event) => update({ projectId: event.target.value })}>
          <SelectOption value="">{labels.form.noProject}</SelectOption>
          {projects.map((project) => <SelectOption key={project.id} value={project.id}>{project.name}</SelectOption>)}
        </Select>
      </label>}
      {requiresProject && !form.projectId ? <p role="status" className="text-sm text-fg-muted">{labels.experience.projectRequired}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-sm text-fg">{labels.form.trigger}
          <Select className={inputClass} value={form.triggerMode} onChange={(event) => update({ triggerMode: event.target.value as TriggerMode })}>
            <SelectOption value="once">{labels.trigger.once}</SelectOption>
            <SelectOption value="daily">{labels.trigger.daily}</SelectOption>
            <SelectOption value="weekly">{labels.trigger.weekly}</SelectOption>
          </Select>
        </label>
        {form.triggerMode === 'once' ? <label className="grid gap-2 text-sm text-fg">{labels.form.onceAt}
          <input type="datetime-local" className={inputClass} value={form.onceAt} onChange={(event) => update({ onceAt: event.target.value })} />
        </label> : <div className="grid gap-2 text-sm text-fg"><span>{labels.form.time}</span>
          <TimePicker value={form.time} onChange={(time) => update({ time })} ariaLabel={labels.form.time} />
        </div>}
        {form.triggerMode === 'weekly' && <label className="grid gap-2 text-sm text-fg">{labels.form.day}
          <Select className={inputClass} value={form.weekday} onChange={(event) => update({ weekday: event.target.value })}>
            {(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const).map((day, index) => <SelectOption key={day} value={String(index)}>{labels.weekdays[day]}</SelectOption>)}
          </Select>
        </label>}
      </div>
      {form.triggerMode === 'once' && form.onceAt && new Date(form.onceAt).getTime() <= Date.now() ? <p role="status" className="text-sm text-red-700 dark:text-red-300">{labels.experience.futureTime}</p> : null}
      <p className="text-xs text-fg-muted">{labels.experience.scheduleNote}</p>
      <label className="grid gap-2 text-sm text-fg">{labels.draft.notifications}
        <Select className={inputClass} value={form.notificationPolicy} onChange={(event) => update({ notificationPolicy: event.target.value as FormState['notificationPolicy'] })}>
          <SelectOption value="all">{labels.draft.notifyAll}</SelectOption>
          <SelectOption value="attention">{labels.draft.notifyAttention}</SelectOption>
          <SelectOption value="none">{labels.draft.notifyNone}</SelectOption>
        </Select>
      </label>
    </div>
  );
}
