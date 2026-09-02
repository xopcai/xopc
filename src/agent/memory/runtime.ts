import type { UserContextConfig } from '../../user-context/config.js';

export type MemorySource = 'session' | 'agentProfile' | 'understanding' | 'workspace';
export type MemoryWriteTarget = 'agentProfile' | 'understanding' | 'workspace';
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
  const memory = userContext.memory;
  const readableSources = !userContext.enabled || memory.mode === 'off' ? [] : [...memory.sources];
  const sourceSet = new Set<MemorySource>(readableSources);
  return {
    readableSources,
    canRead: (source) => sourceSet.has(source),
    checkWrite: (candidate) => {
      if (!userContext.enabled || memory.mode === 'off') return { decision: 'deny', reason: 'memory is disabled' };
      if (memory.mode === 'readOnly') return { decision: 'deny', reason: 'memory is read-only' };
      if (!candidate.content.trim()) return { decision: 'deny', reason: 'memory content is empty' };
      if (normalizeConfidence(candidate.confidence) < 0.3) {
        return { decision: 'deny', reason: 'memory confidence is too low' };
      }
      const sensitivePolicy = userContext.privacy.sensitiveWritePolicy;
      if (candidate.sensitive && sensitivePolicy !== 'allow') {
        return { decision: sensitivePolicy, reason: 'memory candidate is sensitive' };
      }
      const targetPolicy = memory.writePolicy?.[candidate.target] ?? 'deny';
      if (memory.mode === 'confirmWrite' && targetPolicy === 'allow') {
        return { decision: 'confirm', reason: 'agent memory mode requires confirmation' };
      }
      return { decision: targetPolicy, reason: `target policy is ${targetPolicy}` };
    },
  };
}
