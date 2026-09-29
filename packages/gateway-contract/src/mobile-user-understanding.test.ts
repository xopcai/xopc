import { describe, expect, it } from 'vitest';

import {
  MobileUnderstandingFilterSchema,
  MobileUnderstandingPageSchema,
  MobileUserUnderstandingSummarySchema,
} from './mobile-user-understanding.js';

describe('mobile user understanding contract', () => {
  it('accepts the bounded empty summary', () => {
    expect(MobileUserUnderstandingSummarySchema.parse({
      profile: { callName: '', role: '', pronouns: '', timezone: '', locale: '' },
      suggestedCallName: '',
      settings: { memoryEnabled: true, showMemoryReferences: true, sensitiveWritePolicy: 'confirm' },
      counts: { total: 0, explicit: 0, learned: 0, review: 0, workMemory: 0 },
      goals: [],
      recent: [],
      rules: [],
    }).counts.total).toBe(0);
  });

  it('keeps recent goals bounded and explicitly marks the primary goal', () => {
    const summary = MobileUserUnderstandingSummarySchema.parse({
      profile: { callName: '', role: '', pronouns: '', timezone: '', locale: '' },
      suggestedCallName: '',
      settings: { memoryEnabled: true, showMemoryReferences: true, sensitiveWritePolicy: 'confirm' },
      counts: { total: 0, explicit: 0, learned: 0, review: 0, workMemory: 0 },
      goals: [{
        id: 'goal-1', title: 'Ship mobile goals', desiredOutcome: 'The loop can follow a user-confirmed goal.',
        status: 'active', updatedAt: 1, isPrimary: true,
      }],
      recent: [], rules: [],
    });
    expect(summary.goals[0]).toMatchObject({ id: 'goal-1', isPrimary: true });
  });

  it('keeps list filters and pagination explicit', () => {
    expect(MobileUnderstandingFilterSchema.options).toEqual(['all', 'explicit', 'learned', 'review']);
    expect(MobileUnderstandingPageSchema.parse({ items: [], nextCursor: 'next' }).nextCursor).toBe('next');
  });
});
