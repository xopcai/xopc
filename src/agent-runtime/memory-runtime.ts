import type { EffectiveAgentManifest } from '../agent-manifest/schema.js';

export type MemorySource = 'session' | 'userProfile' | 'agentProfile' | 'curated' | 'workspace';
export type MemoryWriteTarget = 'userProfile' | 'agentProfile' | 'curated' | 'workspace';
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

const READ_ONLY_MODES = new Set(['readOnly']);

function normalizeConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export function buildMemoryRuntime(manifest: EffectiveAgentManifest): MemoryRuntime {
  const readableSources = manifest.memory.mode === 'off' ? [] : [...manifest.memory.sources];
  const sourceSet = new Set<MemorySource>(readableSources);

  return {
    readableSources,
    canRead: (source) => sourceSet.has(source),
    checkWrite: (candidate) => {
      if (manifest.memory.mode === 'off') {
        return { decision: 'deny', reason: 'memory is disabled' };
      }
      if (READ_ONLY_MODES.has(manifest.memory.mode)) {
        return { decision: 'deny', reason: 'memory is read-only' };
      }
      if (!candidate.content.trim()) {
        return { decision: 'deny', reason: 'memory content is empty' };
      }
      const confidence = normalizeConfidence(candidate.confidence);
      if (confidence < 0.3) {
        return { decision: 'deny', reason: 'memory confidence is too low' };
      }
      const sensitivePolicy = manifest.memory.privacy?.sensitiveWritePolicy ?? 'confirm';
      if (candidate.sensitive && sensitivePolicy !== 'allow') {
        return {
          decision: sensitivePolicy,
          reason: 'memory candidate is sensitive',
        };
      }
      const targetPolicy = manifest.memory.writePolicy?.[candidate.target] ?? 'deny';
      if (manifest.memory.mode === 'confirmWrite' && targetPolicy === 'allow') {
        return { decision: 'confirm', reason: 'agent memory mode requires confirmation' };
      }
      return {
        decision: targetPolicy,
        reason: `target policy is ${targetPolicy}`,
      };
    },
  };
}
