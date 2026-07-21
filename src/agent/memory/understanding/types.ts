import type {
  MemoryDisclosurePolicy,
  MemoryDurability,
  MemoryExplicitness,
  MemoryKind,
  MemorySensitivity,
} from '../types.js';

export interface UnderstandingCandidate {
  kind: MemoryKind;
  content: string;
  canonicalKey?: string;
  confidence: number;
  importance: number;
  explicitness: MemoryExplicitness;
  durability: MemoryDurability;
  sensitivity: MemorySensitivity;
  disclosurePolicy: MemoryDisclosurePolicy;
  tags?: string[];
  validFrom?: string;
  validTo?: string;
}

export interface UnderstandingReviewResult {
  sourceItemId?: string;
  proposed: number;
  created: number;
  deduplicated: number;
  rejected: number;
  createdRecords: Array<{ id: string; content: string; kind: MemoryKind }>;
}
