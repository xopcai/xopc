import { createHash } from 'node:crypto';

import type { HomeOpportunity } from '@xopcai/gateway-contract';

import type { HomeGenerationReason } from './repository.js';

export interface HomeOpportunityNotification {
  notificationKey: string;
  opportunityId: string;
  title: string;
}

export function buildHomeOpportunityNotification(
  opportunity: HomeOpportunity,
  reasons: readonly HomeGenerationReason[],
  placement: 'primary' | 'compact',
): HomeOpportunityNotification | undefined {
  const backgroundRefresh = reasons.includes('connector_changed') || reasons.includes('scheduled_refresh');
  const foregroundRefresh = reasons.includes('home_opened') || reasons.includes('manual_refresh');
  const hasCrossSourceEvidence = opportunity.evidence.some((item) => (
    item.sourceType === 'calendar' || item.sourceType === 'mail' || item.sourceType === 'communication'
  ));
  if (!backgroundRefresh || foregroundRefresh || placement !== 'primary'
    || opportunity.confidence !== 'high' || opportunity.urgency !== 'now'
    || !opportunity.actions.canStart || !hasCrossSourceEvidence) return undefined;
  const evidenceRevision = opportunity.evidence
    .map((item) => `${item.sourceType}:${item.sourceRef}:${item.revision}`)
    .sort()
    .join('\n');
  return {
    notificationKey: createHash('sha256').update([
      opportunity.kind,
      opportunity.projectId ?? 'global',
      evidenceRevision,
    ].join('\n')).digest('hex'),
    opportunityId: opportunity.id,
    title: opportunity.title,
  };
}
