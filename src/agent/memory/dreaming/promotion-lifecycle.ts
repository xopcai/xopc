import { createHash } from 'node:crypto';

import { upsertMemoryRecord } from '../../../storage/sqlite/index.js';
import type { MemoryRecord, MemorySensitivity } from '../types.js';

export interface RemInsightInput {
  agentId: string;
  workspaceId: string;
  memberKeys: string[];
  representative: string;
  distinctPaths: string[];
  strength: number;
  observedAt: string;
  evidence: string[];
  sensitivity: MemorySensitivity;
  status?: 'active' | 'candidate';
}

export function remPatternKey(memberKeys: string[]): string {
  return createHash('sha256').update([...memberKeys].sort().join('\0')).digest('hex').slice(0, 24);
}

/** Persist a REM cluster as a stable, recallable derived insight. */
export function activateRemInsight(input: RemInsightInput): MemoryRecord {
  const patternKey = remPatternKey(input.memberKeys);
  const content = `Recurring context across ${input.distinctPaths.length} memory sources: ${input.representative}`;
  return upsertMemoryRecord({
    id: `dreaming-rem:${input.agentId}:${patternKey}`,
    providerId: 'local',
    kind: 'derived_insight',
    sourceAgentId: input.agentId,
    workspaceId: input.workspaceId,
    content,
    source: { provider: 'dreaming' },
    confidence: input.strength,
    status: input.status ?? 'active',
    sensitivity: input.sensitivity,
    canonicalKey: `dreaming-rem:${patternKey}`,
    explicitness: 'inferred',
    durability: 'recurring',
    importance: input.strength,
    disclosurePolicy: 'referenceable',
    evidence: input.evidence.slice(0, 8).map((sourceText) => ({
      relation: 'derived_from',
      sourceText,
      observedAt: input.observedAt,
      confidence: input.strength,
    })),
    tags: [
      'dreaming',
      'rem',
      'derived-insight',
      `strength:${input.strength.toFixed(2)}`,
      `sources:${input.distinctPaths.length}`,
    ],
  });
}
