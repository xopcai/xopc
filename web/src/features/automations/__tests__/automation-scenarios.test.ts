import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';

import { buildInput } from '../automation-form';
import { automationScenarios } from '../automation-scenarios';

describe('scenario creation', () => {
  it.each(['en', 'zh'] as const)('provides usable schedules and notifications in %s', (language) => {
    const [reminder, brief, review, followUp] = automationScenarios(messages(language).automations);
    expect(reminder.form.instruction).toBe('');
    expect(reminder.form.triggerMode).toBe('once');
    expect(buildInput(brief.form, null).trigger).toEqual({ kind: 'schedule', schedule: { kind: 'cron', expr: '30 8 * * *' } });
    expect(buildInput(review.form, null).trigger).toEqual({ kind: 'schedule', schedule: { kind: 'cron', expr: '0 17 * * 5' } });
    expect(followUp.requiresProject).toBe(true);
    for (const scene of [brief, review, followUp]) {
      expect(scene.form.notificationPolicy).toBe('all');
      expect(scene.form.instruction.trim().length).toBeGreaterThan(0);
      expect(scene.source.trim().length).toBeGreaterThan(0);
    }
  });
});
