import type { MemoryRecord } from '../agent/memory/types.js';
import { isActionableUnderstandingContent, isNearDuplicateUnderstanding } from './understandingQuality.js';

export const USER_CONFIRMED_MEMORY_TAG = 'user-confirmed';
export const INSIGHT_ACCEPTED_TAG = 'insight-action:accepted';
export const INSIGHT_DISMISSED_TAG = 'insight-action:dismissed';

export type ActionableInsightSuggestion = {
  id: string;
  insight: string;
  kind: MemoryRecord['kind'];
  action: 'make_repeatable' | 'start_progress' | 'add_playbook';
  evidenceCount: number;
  confidence?: number;
  sourceName: string;
};

function actionFor(record: MemoryRecord): ActionableInsightSuggestion['action'] | null {
  if (record.kind === 'routine') return 'make_repeatable';
  if (record.kind === 'long_term_goal') return 'start_progress';
  if (record.kind === 'task_lesson' || record.kind === 'derived_insight') return 'add_playbook';
  return null;
}

export function buildActionableInsightSuggestions(
  records: MemoryRecord[],
  existingTaskTexts: readonly string[],
): ActionableInsightSuggestion[] {
  const selected: ActionableInsightSuggestion[] = [];
  const sorted = records
    .filter((record) => record.status === 'active')
    .filter((record) => record.tags?.includes(USER_CONFIRMED_MEMORY_TAG))
    .filter((record) => !record.tags?.includes(INSIGHT_ACCEPTED_TAG) && !record.tags?.includes(INSIGHT_DISMISSED_TAG))
    .filter((record) => isActionableUnderstandingContent(record.content))
    .filter((record) => record.kind !== 'long_term_goal' || record.durability !== 'ephemeral')
    .sort((left, right) => right.importance - left.importance || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  for (const record of sorted) {
    const action = actionFor(record);
    if (!action) continue;
    if (selected.some((item) => item.action === action && isNearDuplicateUnderstanding(item.insight, record.content))) {
      continue;
    }
    if (action === 'start_progress' && existingTaskTexts.some((text) => isNearDuplicateUnderstanding(text, record.content))) {
      continue;
    }
    selected.push({
      id: record.id,
      insight: record.content,
      kind: record.kind,
      action,
      evidenceCount: record.evidence?.length ?? 0,
      confidence: record.confidence,
      sourceName: record.source.provider ?? 'local',
    });
    if (selected.length === 5) break;
  }
  return selected;
}
