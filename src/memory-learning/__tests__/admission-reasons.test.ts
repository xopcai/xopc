import { afterEach, beforeEach, expect, it } from 'vitest';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { claimContextExtractionRun, finishContextExtractionRun, listContextExtractionOutputs } from '../../storage/sqlite/context-extraction-repository.js';
import { applyWorkCandidates, type WorkCandidate } from '../work-capture.js';

beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
it('persists distinct rejection causes by ordinal without persisting rejected values', () => {
  const run = claimContextExtractionRun({ sourceRef: 'test', extractorId: 'test', extractorVersion: '1', inputHash: 'hash', processingPolicy: 'local_only', destination: 'deterministic' });
  const base: WorkCandidate = { kind: 'project_fact', topicKey: 'contract', predicate: 'contract.contact', statement: '合同联系人林沐。', scope: 'project', confidence: 0.9, importance: 0.8, evidence: [{ ref: 'source', quote: '联系人林沐' }] };
  const output = applyWorkCandidates({ candidates: [base, { ...base, scope: 'workspace', evidence: [{ ref: 'source', quote: 'invented' }] }, { ...base, scope: 'workspace', evidence: [{ ref: 'missing', quote: '联系人林沐' }] }], evidence: [{ ref: 'source', role: 'user', text: '联系人林沐', createdAt: Date.now() }], conversationId: '', agentId: 'main', workspaceId: '/workspace', processingPolicy: 'local_only', runId: run.run.id });
  expect(output.map(row => row.reasonCode)).toEqual(['missing_project_scope', 'evidence_quote_mismatch', 'evidence_ref_missing']);
  const receipt = finishContextExtractionRun({ runId: run.run.id, status: 'completed', outputs: output });
  expect(receipt?.status).toBe('completed');
  expect(receipt?.errorCode).not.toContain('林沐');
  expect(listContextExtractionOutputs(run.run.id).map(row => row.reasonCode)).toEqual(['missing_project_scope', 'evidence_quote_mismatch', 'evidence_ref_missing']);
});
