import type { OutcomeContextManifest } from '@xopcai/gateway-contract';

import {
  getSessionMetadata,
  isXopcDatabaseOpen,
  listExecutionReceipts,
} from '../storage/sqlite/index.js';
import { OutcomeRepository } from './outcome-repository.js';

export interface OutcomeContextAllocation {
  profile: 'standard' | 'deep' | 'critical';
  maxResults: number;
  maxChars: number;
  reason: string;
}

export interface AssembledOutcomeContext {
  outcomeId?: string;
  retrievalQuery: string;
  allocation: OutcomeContextAllocation;
  manifest?: OutcomeContextManifest;
}

const STANDARD: OutcomeContextAllocation = {
  profile: 'standard',
  maxResults: 12,
  maxChars: 12_000,
  reason: 'No active outcome requires expanded context.',
};

export function getOutcomeContextManifest(outcomeId: string): OutcomeContextManifest | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const outcome = new OutcomeRepository().get(outcomeId);
  if (!outcome?.contract) return undefined;
  const latestReceipt = listExecutionReceipts({ outcomeId, limit: 1 })[0];
  const unresolvedCriteria = latestReceipt?.verification.checks
    .filter((check) => check.status !== 'passed')
    .map((check) => check.criterion) ?? outcome.contract.acceptanceCriteria;
  const critical = outcome.importance === 'critical'
    || outcome.contract.risks.length > 0
    || outcome.contract.approvalRequired.length > 0;
  return {
    outcomeId,
    sources: [
      {
        kind: 'outcome_contract',
        id: `${outcomeId}:${outcome.contract.version}`,
        description: 'Current outcome contract and completion criteria',
      },
      ...(latestReceipt ? [{
        kind: 'execution_receipt' as const,
        id: latestReceipt.runId,
        description: 'Latest execution evidence and verification result',
      }] : []),
      ...(latestReceipt?.correctionText ? [{
        kind: 'user_correction' as const,
        id: latestReceipt.runId,
        description: latestReceipt.correctionText,
      }] : []),
    ],
    assumptions: outcome.contract.assumptions,
    unresolvedCriteria,
    allocation: critical ? 'critical' : 'deep',
  };
}

export function assembleOutcomeContext(sessionKey: string, userQuery: string): AssembledOutcomeContext {
  const query = userQuery.trim();
  if (!isXopcDatabaseOpen()) return { retrievalQuery: query, allocation: STANDARD };
  const metadata = getSessionMetadata(sessionKey);
  const outcomeId = typeof metadata?.customData?.outcomeId === 'string'
    ? metadata.customData.outcomeId.trim()
    : '';
  if (!outcomeId) return { retrievalQuery: query, allocation: STANDARD };

  const outcome = new OutcomeRepository().get(outcomeId);
  if (!outcome?.contract) return { outcomeId, retrievalQuery: query, allocation: STANDARD };
  const contract = outcome.contract;
  const latestReceipt = listExecutionReceipts({ outcomeId, limit: 1 })[0];
  const remainingCriteria = latestReceipt?.verification.checks
    .filter((check) => check.status !== 'passed')
    .map((check) => check.criterion) ?? contract.acceptanceCriteria;
  const critical = outcome.importance === 'critical'
    || contract.risks.length > 0
    || contract.approvalRequired.length > 0;
  const continuing = outcome.internalStatus === 'continuing'
    || latestReceipt?.completionVerdict === 'partial'
    || latestReceipt?.completionVerdict === 'not_achieved';
  const allocation: OutcomeContextAllocation = critical
    ? {
        profile: 'critical',
        maxResults: 32,
        maxChars: 64_000,
        reason: 'The outcome contains material risk or approval boundaries.',
      }
    : continuing
      ? {
          profile: 'deep',
          maxResults: 24,
          maxChars: 40_000,
          reason: 'The outcome is continuing after incomplete or failed work.',
        }
      : {
          profile: 'deep',
          maxResults: 20,
          maxChars: 32_000,
          reason: 'An active outcome benefits from complete user and decision context.',
        };
  const manifest = getOutcomeContextManifest(outcomeId);
  const sections = [
    query,
    `Outcome: ${contract.objective}`,
    contract.deliverables.length ? `Deliverables: ${contract.deliverables.join('; ')}` : '',
    remainingCriteria.length ? `Remaining acceptance criteria: ${remainingCriteria.join('; ')}` : '',
    contract.constraints.length ? `Constraints: ${contract.constraints.join('; ')}` : '',
    contract.assumptions.length ? `Assumptions: ${contract.assumptions.join('; ')}` : '',
    contract.risks.length ? `Risks: ${contract.risks.join('; ')}` : '',
    latestReceipt?.correctionText ? `User correction: ${latestReceipt.correctionText}` : '',
    latestReceipt?.summary ? `Latest execution result: ${latestReceipt.summary}` : '',
  ].filter(Boolean);
  return {
    outcomeId,
    retrievalQuery: sections.join('\n'),
    allocation,
    ...(manifest ? { manifest } : {}),
  };
}
