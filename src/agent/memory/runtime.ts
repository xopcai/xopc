import type { UserContextConfig } from '../../user-context/config.js';

export type MemorySource = 'session' | 'workspace' | 'project' | 'connector';
export type MemoryWriteTarget = 'knowledge';
export type MemoryWriteDecision = 'allow' | 'confirm' | 'deny';

export interface MemoryCandidate {
  target: MemoryWriteTarget;
  content: string;
  source: string;
  confidence?: number;
  sensitive?: boolean;
}

export interface MemoryWriteCheckResult {
  decision: MemoryWriteDecision;
  reason: string;
}

export interface MemoryRuntime {
  readableSources: MemorySource[];
  canRead: (source: MemorySource) => boolean;
  checkWrite: (candidate: MemoryCandidate) => MemoryWriteCheckResult;
}

function normalizeConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export function buildMemoryRuntime(userContext: UserContextConfig): MemoryRuntime {
  const memory = userContext.knowledgeMemory;
  const readableSources = !userContext.enabled || !memory.enabled ? [] : [...memory.sources];
  const sourceSet = new Set<MemorySource>(readableSources);
  return {
    readableSources,
    canRead: (source) => sourceSet.has(source),
    checkWrite: (candidate) => {
      if (!userContext.enabled || !memory.enabled) return { decision: 'deny', reason: 'knowledge memory is disabled' };
      if (!candidate.content.trim()) return { decision: 'deny', reason: 'memory content is empty' };
      if (normalizeConfidence(candidate.confidence) < 0.3) {
        return { decision: 'deny', reason: 'memory confidence is too low' };
      }
      if (candidate.sensitive && memory.writePolicy !== 'allow') {
        return { decision: memory.writePolicy, reason: 'knowledge candidate is sensitive' };
      }
      return { decision: memory.writePolicy, reason: `knowledge write policy is ${memory.writePolicy}` };
    },
  };
}
