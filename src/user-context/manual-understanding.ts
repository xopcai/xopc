import { nextMemoryReviewAt } from '../agent/memory/lifecycle.js';
import type { MemoryKind, MemoryRecord } from '../agent/memory/types.js';
import { listMemoryRecords, upsertMemoryRecord } from '../storage/sqlite/index.js';
import { USER_CONFIRMED_MEMORY_TAG } from './actionableInsights.js';
import { isUserContextRecord } from './projection.js';

export type ManualUnderstandingScope =
  | { type: 'global' }
  | { type: 'session'; sessionKey: string };

const STATUSES: MemoryRecord['status'][] = [
  'candidate',
  'active',
  'needs_review',
  'stale',
  'archived',
  'rejected',
];

function sameScope(record: MemoryRecord, scope: ManualUnderstandingScope): boolean {
  if (scope.type === 'session') return record.scope.sessionKey === scope.sessionKey;
  return !record.scope.sessionKey && !record.scope.projectId && !record.scope.workspaceId;
}

function findDuplicate(content: string, scope: ManualUnderstandingScope): MemoryRecord | undefined {
  const normalized = content.toLocaleLowerCase();
  for (const status of STATUSES) {
    let offset = 0;
    while (true) {
      const page = listMemoryRecords({ status, limit: 500, offset });
      const duplicate = page.find((record) => (
        isUserContextRecord(record)
        && sameScope(record, scope)
        && record.content.trim().toLocaleLowerCase() === normalized
      ));
      if (duplicate) return duplicate;
      if (page.length < 500) break;
      offset += page.length;
    }
  }
  return undefined;
}

export function createManualUnderstanding(input: {
  agentId: string;
  content: string;
  kind: MemoryKind;
  scope: ManualUnderstandingScope;
  sensitivity: NonNullable<MemoryRecord['sensitivity']>;
  durability: MemoryRecord['durability'];
  disclosurePolicy: MemoryRecord['disclosurePolicy'];
}): { record: MemoryRecord; created: boolean } {
  const duplicate = findDuplicate(input.content, input.scope);
  if (duplicate) return { record: duplicate, created: false };
  const record = upsertMemoryRecord({
    providerId: 'local',
    kind: input.kind,
    sourceAgentId: input.agentId,
    ...(input.scope.type === 'session' ? { sessionKey: input.scope.sessionKey } : {}),
    content: input.content,
    source: { provider: 'local', path: 'you://manual' },
    confidence: 1,
    tags: ['user-understanding', 'explicit-user-memory', USER_CONFIRMED_MEMORY_TAG],
    status: 'active',
    sensitivity: input.sensitivity,
    explicitness: 'explicit',
    durability: input.durability,
    importance: 0.8,
    disclosurePolicy: input.disclosurePolicy,
    reviewAfter: nextMemoryReviewAt({ durability: input.durability, explicitness: 'explicit' }),
  });
  return { record, created: true };
}
