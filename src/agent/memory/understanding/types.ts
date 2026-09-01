import type { UnderstandingKind, UserUnderstanding } from '../../../user-context/domain.js';

export interface UnderstandingCandidate {
  kind: UnderstandingKind;
  content: string;
  payload?: Record<string, unknown>;
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
  createdRecords: Array<{
    id: string;
    content: string;
    kind: UnderstandingKind;
    status: UserUnderstanding['status'];
  }>;
  writeOutputs?: Array<{
    candidateKey: string;
    objectId?: string;
    versionId?: string;
    outcome: 'created' | 'deduplicated' | 'rejected';
  }>;
}
