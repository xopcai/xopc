import type { UnderstandingSourceItem, UserFocus } from './types.js';
import { clusterUnderstandingSignals, type UnderstandingSignal } from './signal-clustering.js';

export type ActivityTopic = Pick<UserFocus,
  'canonicalKey' | 'title' | 'summary' | 'horizon' | 'confidence' | 'evidenceRefs'> & {
    sourceIds: string[];
  };

function activityTimestamp(item: UnderstandingSourceItem): number {
  return item.modifiedAt ?? item.occurredAt ?? item.startsAt ?? 0;
}

function resourceHost(item: UnderstandingSourceItem): string | undefined {
  if (!item.resourceUri) return undefined;
  try {
    return new URL(item.resourceUri).hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

export function clusterActivityTopics(items: UnderstandingSourceItem[], now = Date.now()): ActivityTopic[] {
  const eligible = items.filter((item) => item.type === 'document' || item.type === 'bookmark');
  const byEvidenceRef = new Map(eligible.map((item) => [item.evidenceRef, item]));
  const signals: UnderstandingSignal[] = eligible.map((item) => ({
    evidenceRef: item.evidenceRef,
    sourceId: item.sourceId,
    title: item.title,
    group: [item.group, resourceHost(item)].filter(Boolean).join(' ') || undefined,
    occurredAt: activityTimestamp(item),
  }));

  return clusterUnderstandingSignals(signals, now).flatMap((cluster): ActivityTopic[] => {
    const sourceItems = cluster.signals
      .map((signal) => byEvidenceRef.get(signal.evidenceRef))
      .filter((item): item is UnderstandingSourceItem => Boolean(item));
    const types = new Set(sourceItems.map((item) => item.type));
    if (types.size === 1 && types.has('bookmark') && sourceItems.length < 3) return [];
    const fileCount = sourceItems.filter((item) => item.type === 'document').length;
    const bookmarkCount = sourceItems.length - fileCount;
    const evidenceRefs = cluster.signals.map((signal) => signal.evidenceRef);
    const evidenceSummary = [
      fileCount ? `${fileCount} recent file${fileCount === 1 ? '' : 's'}` : '',
      bookmarkCount ? `${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ');
    return [{
      canonicalKey: `activity-focus:${cluster.key}`,
      title: cluster.title,
      summary: `${evidenceSummary} suggest sustained attention to ${cluster.title}.`,
      horizon: cluster.horizon,
      confidence: cluster.confidence,
      evidenceRefs,
      sourceIds: cluster.sourceIds,
    }];
  });
}
