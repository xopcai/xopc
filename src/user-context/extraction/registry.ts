import { createHash } from 'node:crypto';

import {
  claimContextExtractionRun,
  finishContextExtractionRun,
  type ContextExtractionRun,
} from '../../storage/sqlite/index.js';
import type { UnderstandingKind } from '../domain.js';

export type ExtractorId =
  | 'turn-semantics'
  | 'transcript-synthesis'
  | 'connector-semantic';

export type ExtractorDefinition = {
  id: ExtractorId;
  version: string;
  inputKinds: Array<'conversation' | 'connector' | 'file' | 'task'>;
  requiredProcessingPolicy: 'local_only' | 'remote_allowed';
  authorityCeiling: 'user_explicit' | 'user_observed' | 'system_inferred' | 'external_untrusted';
  candidateKinds: UnderstandingKind[];
  maxAutomaticStatus: 'active' | 'candidate';
  timeoutMs: number;
};

const UNDERSTANDING_KINDS: UnderstandingKind[] = [
  'preference', 'boundary', 'relationship', 'routine', 'current_state',
  'long_term_goal', 'project_context', 'task_lesson', 'derived_insight',
];

const DEFINITIONS: Record<ExtractorId, ExtractorDefinition> = {
  'turn-semantics': {
    id: 'turn-semantics', version: '1', inputKinds: ['conversation'], requiredProcessingPolicy: 'local_only',
    authorityCeiling: 'user_explicit', candidateKinds: UNDERSTANDING_KINDS, maxAutomaticStatus: 'active', timeoutMs: 30_000,
  },
  'transcript-synthesis': {
    id: 'transcript-synthesis', version: '1', inputKinds: ['conversation'], requiredProcessingPolicy: 'local_only',
    authorityCeiling: 'system_inferred', candidateKinds: UNDERSTANDING_KINDS, maxAutomaticStatus: 'candidate', timeoutMs: 30_000,
  },
  'connector-semantic': {
    id: 'connector-semantic', version: '1', inputKinds: ['connector', 'file'], requiredProcessingPolicy: 'remote_allowed',
    authorityCeiling: 'external_untrusted', candidateKinds: ['preference', 'routine'],
    maxAutomaticStatus: 'candidate', timeoutMs: 30_000,
  },
};

export function getExtractorDefinition(id: ExtractorId): ExtractorDefinition {
  return DEFINITIONS[id];
}

export function getRegisteredExtractorDefinition(id: string): ExtractorDefinition | undefined {
  return DEFINITIONS[id as ExtractorId];
}

export function extractionInputHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function claimRegisteredExtraction(input: {
  extractorId: ExtractorId;
  sourceRef: string;
  contentForHash: string;
  processingPolicy: 'local_only' | 'remote_allowed';
  destination: ContextExtractionRun['destination'];
}): { run: ContextExtractionRun; shouldExecute: boolean } {
  const definition = getExtractorDefinition(input.extractorId);
  const claimed = claimContextExtractionRun({
    sourceRef: input.sourceRef, extractorId: definition.id, extractorVersion: definition.version,
    processingPolicy: input.processingPolicy, destination: input.destination,
    inputHash: extractionInputHash(input.contentForHash),
  });
  if (definition.requiredProcessingPolicy === 'remote_allowed' && input.processingPolicy !== 'remote_allowed') {
    if (claimed.run.status === 'running') {
      finishContextExtractionRun({ runId: claimed.run.id, status: 'skipped', errorCode: 'processing_policy' });
    }
    return { run: { ...claimed.run, status: 'skipped' }, shouldExecute: false };
  }
  return claimed;
}
