import { expect, it } from 'vitest';
import { scheduledRunPreview } from './schedule-preview';
import { buildInput, buildAutomationEditInput, formFromAutomation, initialForm } from './automation-form';
import { computeNextScheduleRunAtMs } from '../../../../src/automations/domain/schedule';
import type { Automation } from './automation-api';

it.each(['Asia/Shanghai', 'America/New_York', 'Europe/Berlin'])('matches the service scheduler for three absolute times across DST in %s', timezone => {
  const form = { ...initialForm, triggerMode: 'daily' as const, timezone, time: '02:30' };
  const start = new Date('2026-03-07T12:00:00Z');
  const input = buildInput(form);
  expect(input.trigger).toMatchObject({ schedule: { tz: timezone } });
  if (input.trigger.kind !== 'schedule') throw new Error('Expected schedule');
  let cursor = start.getTime();
  const expected: string[] = [];
  for (let index = 0; index < 3; index++) { cursor = computeNextScheduleRunAtMs(input.trigger.schedule, cursor)!; expected.push(new Date(cursor).toISOString()); }
  expect(scheduledRunPreview(form, start)).toEqual(expected);
});
it('preserves an unspecified legacy service timezone when editing unrelated fields', () => {
  const automation = { ...buildInput({ ...initialForm, timezone: '' }), id: 'legacy', createdAtMs: 1, updatedAtMs: 1 } as Automation;
  const form = formFromAutomation(automation);
  expect(form.timezone).toBe('');
  expect(scheduledRunPreview(form)).toEqual([]);
  expect(buildAutomationEditInput(automation, { ...form, name: 'Renamed' }).trigger).toEqual(automation.trigger);
});
it('rejects invalid timezone input rather than inventing a run preview', () => {
  expect(() => scheduledRunPreview({ ...initialForm, timezone: 'Not/A_Zone' })).toThrow();
});

it('does not skip the daily run on the spring-forward date', () => {
  expect(scheduledRunPreview({ ...initialForm, triggerMode: 'daily', timezone: 'America/New_York', time: '09:00' }, new Date('2026-03-07T15:00:00Z'))).toEqual([
    '2026-03-08T13:00:00.000Z', '2026-03-09T13:00:00.000Z', '2026-03-10T13:00:00.000Z',
  ]);
});
