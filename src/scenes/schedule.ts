import { DateTime } from 'luxon';
import { z } from 'zod';

/** A local wall-clock schedule, not an arbitrary cron or workflow language. */
export const sceneScheduleSchema = z.strictObject({
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine((days) => new Set(days).size === days.length, 'Duplicate weekdays'),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  timeZone: z.string().trim().min(1).max(100).refine((timeZone) => {
    try { new Intl.DateTimeFormat('en', { timeZone }); return DateTime.now().setZone(timeZone).isValid; }
    catch { return false; }
  }, 'Invalid time zone'),
});

export function nextSceneScheduleAt(value: unknown, now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid scene schedule time');
  const schedule = sceneScheduleSchema.parse(value);
  const today = DateTime.fromMillis(now, { zone: schedule.timeZone }).startOf('day');
  for (let day = 0; day < 15; day += 1) {
    const date = today.plus({ days: day });
    if (!schedule.weekdays.includes(date.weekday % 7)) continue;
    const candidate = date.set({ hour: schedule.hour, minute: schedule.minute, second: 0, millisecond: 0 });
    // Skip nonexistent wall times; choose only the first occurrence of a repeated time.
    if (candidate.hour !== schedule.hour || candidate.minute !== schedule.minute) continue;
    const first = Math.min(...candidate.getPossibleOffsets().map((value) => value.toMillis()));
    if (first > now) return first;
  }
  throw new Error('No scene schedule occurrence within the search window');
}
