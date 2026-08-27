export type CapabilityId = 'vision' | 'image-generation' | 'stt' | 'tts';

export type CandidateSource =
  | 'native-model'
  | 'explicit-config'
  | 'installed-local'
  | 'xopc-cloud-managed'
  | 'configured-provider'
  | 'credentialless-fallback';

export interface CapabilityCandidate {
  capability: CapabilityId;
  provider: string;
  model: string;
  source: CandidateSource;
  ready: boolean;
  priority: number;
  reasons: string[];
  metadata?: Record<string, unknown>;
}

export interface CapabilityPlan {
  capability: CapabilityId;
  status: 'ready' | 'degraded' | 'unavailable' | 'disabled';
  primary?: CapabilityCandidate;
  fallbacks: CapabilityCandidate[];
  rejected: CapabilityCandidate[];
  selectionSource: CandidateSource | 'none';
  catalogVersion?: string | null;
}

export interface CapabilityPolicy {
  disabled?: boolean;
  explicit?: Array<{ provider: string; model: string; ready?: boolean; reasons?: string[] }>;
}

export interface CapabilityPlannerInput {
  policies: Record<CapabilityId, CapabilityPolicy>;
  automatic: Partial<Record<CapabilityId, CapabilityCandidate[]>>;
  catalogVersion?: string | null;
}
