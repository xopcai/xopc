import { DEFAULT_PERSONAL_IDLE_COMPACTION } from '../../user-context/config.js';
import type { Config } from '../../config/schema.js';
import {
  DEFAULT_COMPACTION_CONFIG,
  type CompactionConfig,
} from './compaction.js';

export interface ResolvedCompactionPolicy extends CompactionConfig {
  personalIdle: typeof DEFAULT_PERSONAL_IDLE_COMPACTION & { model?: string };
  reserveTokens: number;
  model?: string;
  minToolResultKeepChars: number;
  maxActiveTranscriptBytes: number;
  postCompactionSections: string[];
}

const POLICY_DEFAULTS: ResolvedCompactionPolicy = {
  ...DEFAULT_COMPACTION_CONFIG,
  personalIdle: { ...DEFAULT_PERSONAL_IDLE_COMPACTION },
  reserveTokens: 8_192,
  minToolResultKeepChars: 1_000,
  maxActiveTranscriptBytes: 2_000_000,
  postCompactionSections: ['Session Startup', 'Red Lines'],
};

export function resolveCompactionPolicy(config?: Config): ResolvedCompactionPolicy {
  const configured = config?.userContext.contextPlanning.compaction;
  if (!configured) return { ...POLICY_DEFAULTS, postCompactionSections: [...POLICY_DEFAULTS.postCompactionSections] };
  return {
    ...POLICY_DEFAULTS,
    ...configured,
    accumulateUsage: true,
    postCompactionSections: [...configured.postCompactionSections],
  };
}
