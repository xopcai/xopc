import { CronExpressionParser } from 'cron-parser';
import { FormField } from '@/components/ui/form-field';
import { buildInput, type FormState } from './automation-form';

export function scheduledRunPreview(form: FormState, now = new Date()): string[] {
  const input = buildInput(form);
  if (input.trigger.kind !== 'schedule' || input.trigger.schedule.kind !== 'cron' || !input.trigger.schedule.tz) return [];
  const interval = CronExpressionParser.parse(input.trigger.schedule.expr, { currentDate: now, tz: input.trigger.schedule.tz });
  return [new Date(interval.next().getTime()).toISOString(), new Date(interval.next().getTime()).toISOString(), new Date(interval.next().getTime()).toISOString()];
}
export function SchedulePreview({ form, onChange, language }: { form: FormState; onChange: (patch: Partial<FormState>) => void; language: 'zh' | 'en' }) {
  if (!['daily', 'weekly', 'cron', 'once'].includes(form.triggerMode)) return null;
  const zh = language === 'zh';
  if (form.triggerMode === 'once') return <p className="text-xs text-fg-muted">{zh ? '按当前浏览器时区输入，保存为绝对时间：' : 'Entered in this browser timezone and stored as an absolute time: '}{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>;
  let runs: string[] = [];
  let invalid = false;
  try { runs = scheduledRunPreview(form); } catch { invalid = true; }
  return <details className="rounded-lg bg-surface-base p-3">
    <summary className="cursor-pointer text-xs text-fg-muted focus-visible:outline-accent">{zh ? '时区与接下来的运行时间' : 'Timezone and upcoming runs'}{form.timezone ? ` · ${form.timezone}` : ''}</summary>
    <div className="mt-3 space-y-2">
    <FormField label={zh ? '时区' : 'Timezone'}><input className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg" value={form.timezone ?? ''} placeholder="Asia/Shanghai" onChange={event => onChange({ timezone: event.target.value })} aria-invalid={invalid} /></FormField>
    <p className="text-xs text-fg-muted">{form.timezone ? (zh ? `按 ${form.timezone} 运行；下方显示执行时区时间与当前浏览器的当地时间。` : `Runs in ${form.timezone}; schedule-zone and browser-local times follow.`) : (zh ? '此规则未指定时区，沿用服务所在电脑的时区。指定时区后可预览；更改前请确认原定时间。' : 'This legacy rule uses the service computer timezone. Specify a timezone to preview; confirm the intended schedule before changing it.')}</p>
    {invalid ? <p role="alert" className="text-xs text-danger">{zh ? '请检查时区和定时规则。' : 'Check the timezone and schedule expression.'}</p> : <ol className="space-y-1 text-xs text-fg-muted">{runs.map(run => <li key={run}>{new Date(run).toLocaleString(zh ? 'zh-CN' : 'en-US', { timeZone: form.timezone, timeZoneName: 'short' })} · {zh ? '你这里：' : 'Your local time: '}{new Date(run).toLocaleString(zh ? 'zh-CN' : 'en-US', { timeZoneName: 'short' })}</li>)}</ol>}
  </div></details>;
}
