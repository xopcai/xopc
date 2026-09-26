import { describe, expect, it } from 'vitest';
import { AutomationSchema, AutomationRunSchema, AutomationRunEventSchema } from './automations.js';

describe('current automation contract', () => {
  it('preserves current conversation and notification policy fields', () => {
    const parsed = AutomationSchema.parse({ id: 'a', name: 'Review', enabled: true, trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'Review' }, state: {}, createdAtMs: 1, updatedAtMs: 1,
      conversationMode: 'continuous', delivery: { notificationPolicy: 'none', completionWebhookUrl: 'https://example.com/hook' } });
    expect(parsed).toMatchObject({ conversationMode: 'continuous', delivery: { notificationPolicy: 'none', completionWebhookUrl: 'https://example.com/hook' } });
  });
  it('accepts completion hooks and rejects obsolete run phases and events', () => {
    expect(() => AutomationRunSchema.shape.currentPhase.parse('completion_hook')).toThrow();
    expect(AutomationRunSchema.shape.currentPhase.safeParse('after_run').success).toBe(false);
    expect(() => AutomationRunEventSchema.shape.type.parse('completion_hook.completed')).toThrow();
    expect(AutomationRunEventSchema.shape.type.safeParse('after_run.completed').success).toBe(false);
  });
});
