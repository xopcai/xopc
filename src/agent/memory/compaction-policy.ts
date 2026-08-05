import type { Config } from '../../config/schema.js';
import {
  DEFAULT_COMPACTION_CONFIG,
  type CompactionConfig,
} from './compaction.js';

export interface ResolvedCompactionPolicy extends CompactionConfig {
  reserveTokens: number;
  model?: string;
  minToolResultKeepChars: number;
  maxActiveTranscriptBytes: number;
  postCompactionSections: string[];
}

const POLICY_DEFAULTS: ResolvedCompactionPolicy = {
  ...DEFAULT_COMPACTION_CONFIG,
  reserveTokens: 8_192,
  minToolResultKeepChars: 1_000,
  maxActiveTranscriptBytes: 2_000_000,
  postCompactionSections: ['Session Startup', 'Red Lines'],
};

export function resolveCompactionPolicy(config?: Config): ResolvedCompactionPolicy {
  const configured = config?.userContext.memory.retention?.compaction;
  if (!configured) return { ...POLICY_DEFAULTS, postCompactionSections: [...POLICY_DEFAULTS.postCompactionSections] };
  return {
    ...POLICY_DEFAULTS,
    ...configured,
    accumulateUsage: true,
    postCompactionSections: [...configured.postCompactionSections],
  };
}
