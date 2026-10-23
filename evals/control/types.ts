export type Row = Record<string, unknown>;
export const record = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const string = (value: unknown): string | null => typeof value === 'string' && value.length ? value : null;
export const count = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export type EvidenceClass = 'deterministic' | 'harness_calibration' | 'live_controlled' | 'live_product' | 'unknown';
export interface EvidenceSource {
  path: string;
  kind: 'coder-db' | 'delivery' | 'style' | 'memory';
  benchmark: string;
  evidenceClass: EvidenceClass;
  expected?: number;
  manifest?: string;
  review?: string;
}
export interface Trial {
  id: string;
  caseId: string;
  variant: string;
  repetition: number;
  execution: string;
  assessment: string;
  durationMs: number | null;
  tokens: number | null;
  sourceRunId: string | null;
  sourceFingerprint: string | null;
}
export interface Evidence {
  schemaVersion: 1;
  normalizationVersion: 2;
  id: string;
  logicalId: string;
  benchmark: string;
  evidenceClass: EvidenceClass;
  source: string;
  sourceHash: string;
  importedAt: string;
  createdAt: string | null;
  expected: number | null;
  complete: boolean;
  validity: 'valid' | 'invalid' | 'unknown';
  reasons: string[];
  promotion: string;
  identity: Record<string, string | null>;
  trials: Trial[];
  metrics: Row;
  lineage: string | null;
}
export interface RegistryEntry {
  id: string;
  owner: string;
  scenarios: string[];
  capabilities: string[];
  level: string;
  lifecycle: 'available' | 'planned';
}
