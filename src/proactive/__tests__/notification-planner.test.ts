import { describe, expect, it } from 'vitest';

import { proactivePlan } from '../notifications/planner.js';

describe('Proactive notification planning', () => {
  it('maps the real proactive inbox DTO to an insight notification', () => {
    expect(proactivePlan({
      id: 'inbox-1',
      insightId: 'insight-1',
      insight: { title: 'Delivery risk', summary: 'A blocker needs attention.', urgency: 'high', attentionKind: 'information' },
    })).toMatchObject({
      dedupeKey: 'proactive.insight:inbox-1',
      notification: {
        type: 'proactive.insight',
        target: { kind: 'insight', inboxItemId: 'inbox-1' },
        payload: { inboxItemId: 'inbox-1', insightId: 'insight-1' },
      },
    });
  });

  it('keeps routine information in Home while still pushing decisions', () => {
    expect(proactivePlan({
      id: 'info-1', insightId: 'insight-info',
      insight: { title: 'Routine insight', urgency: 'medium', attentionKind: 'information' },
    })).toBeNull();
    expect(proactivePlan({
      id: 'decision-1', insightId: 'insight-decision',
      insight: { title: 'Choose an owner', urgency: 'medium', attentionKind: 'decision' },
    })).toMatchObject({ notification: { priority: 'high' } });
    expect(proactivePlan({
      id: 'receipt-1', insightId: 'insight-receipt',
      insight: { title: 'Action completed', urgency: 'high', attentionKind: 'receipt' },
    })).toBeNull();
  });

});
