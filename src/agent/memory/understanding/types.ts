import type { UnderstandingKind, UserUnderstanding } from '../../../user-context/domain.js';

export interface UnderstandingCandidate {
  kind: UnderstandingKind;
  content: string;
  canonicalKey?: string;
  confidence: number;
  importance: number;
  explicitness: UserUnderstanding['explicitness'];
  durability: UserUnderstanding['durability'];
  sensitivity: UserUnderstanding['sensitivity'];
  disclosurePolicy: UserUnderstanding['disclosurePolicy'];
  validFrom?: string;
  validTo?: string;
}

export interface UnderstandingReviewResult {
  sourceItemId?: string;
  proposed: number;
  created: number;
  deduplicated: number;
  rejected: number;
  createdRecords: Array<{ id: string; content: string; kind: UnderstandingKind }>;
}
