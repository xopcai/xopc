import { describe, expect, it } from 'vitest';

import type { HomeOpportunity } from '@xopcai/gateway-contract';

import { buildHomeOpportunityNotification } from '../notification.js';

const opportunity: HomeOpportunity = {
  id: 'meeting-1', revision: 1, kind: 'meeting_prep', title: '准备十点项目评审',
  outcome: '形成一页会前简报', rationale: '会议即将开始',
  evidence: [{
    id: 'calendar:1', sourceType: 'calendar', sourceRef: 'event-1', revision: '2',
    observation: '项目评审十点开始', observedAt: 1, freshUntil: 10_000,
  }],
  confidence: 'high', urgency: 'now', risk: 'external_read', proposedSteps: ['整理材料'],
  capabilities: [], verification: ['简报引用当前项目事实'], actionPrompt: '准备会前简报。',
  actions: { canStart: true, canDiscuss: true, degradedStartAvailable: false },
  generatedAt: 1, expiresAt: 10_000,
};

describe('buildHomeOpportunityNotification', () => {
  it('notifies only for high-value background cross-source moments', () => {
    expect(buildHomeOpportunityNotification(opportunity, ['connector_changed'], 'primary')).toMatchObject({
      opportunityId: 'meeting-1', title: '准备十点项目评审',
    });
    expect(buildHomeOpportunityNotification(opportunity, ['manual_refresh'], 'primary')).toBeUndefined();
    expect(buildHomeOpportunityNotification(opportunity, ['connector_changed', 'home_opened'], 'primary')).toBeUndefined();
    expect(buildHomeOpportunityNotification({ ...opportunity, urgency: 'today' }, ['connector_changed'], 'primary')).toBeUndefined();
    expect(buildHomeOpportunityNotification({
      ...opportunity,
      evidence: [{ ...opportunity.evidence[0]!, sourceType: 'project' }],
    }, ['connector_changed'], 'primary')).toBeUndefined();
  });

  it('uses evidence revisions for stable notification deduplication', () => {
    const first = buildHomeOpportunityNotification(opportunity, ['scheduled_refresh'], 'primary');
    const repeated = buildHomeOpportunityNotification({ ...opportunity, id: 'regenerated' }, ['scheduled_refresh'], 'primary');
    const changed = buildHomeOpportunityNotification({
      ...opportunity,
      evidence: [{ ...opportunity.evidence[0]!, revision: '3' }],
    }, ['scheduled_refresh'], 'primary');
    expect(repeated?.notificationKey).toBe(first?.notificationKey);
    expect(changed?.notificationKey).not.toBe(first?.notificationKey);
  });
});
