import { createHash } from 'node:crypto';

import {
  claimContextExtractionRun,
  finishContextExtractionRun,
  type ContextExtractionRun,
} from '../../storage/sqlite/index.js';
import type { UnderstandingKind } from '../domain.js';

export type ExtractorId =
  | 'explicit-command'
  | 'deterministic-signal'
  | 'transcript-synthesis'
  | 'connector-structural'
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
  'explicit-command': {
    id: 'explicit-command', version: '1', inputKinds: ['conversation'], requiredProcessingPolicy: 'local_only',
    authorityCeiling: 'user_explicit', candidateKinds: UNDERSTANDING_KINDS, maxAutomaticStatus: 'active', timeoutMs: 500,
  },
  'deterministic-signal': {
    id: 'deterministic-signal', version: '1', inputKinds: ['conversation', 'task'], requiredProcessingPolicy: 'local_only',
    authorityCeiling: 'user_observed', candidateKinds: UNDERSTANDING_KINDS, maxAutomaticStatus: 'candidate', timeoutMs: 500,
  },
  'transcript-synthesis': {
    id: 'transcript-synthesis', version: '1', inputKinds: ['conversation'], requiredProcessingPolicy: 'remote_allowed',
    authorityCeiling: 'system_inferred', candidateKinds: UNDERSTANDING_KINDS, maxAutomaticStatus: 'candidate', timeoutMs: 30_000,
  },
  'connector-structural': {
    id: 'connector-structural', version: '1', inputKinds: ['connector'], requiredProcessingPolicy: 'local_only',
    authorityCeiling: 'external_untrusted', candidateKinds: ['project_context', 'current_state', 'routine'], maxAutomaticStatus: 'candidate', timeoutMs: 10_000,
  },
  'connector-semantic': {
    id: 'connector-semantic', version: '1', inputKinds: ['connector', 'file'], requiredProcessingPolicy: 'remote_allowed',
    authorityCeiling: 'external_untrusted', candidateKinds: ['preference', 'routine', 'current_state', 'project_context'],
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
