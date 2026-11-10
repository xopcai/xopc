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

it.each(['用户喜欢冗长铺垫。', 'Prefers long introductions.', '习惯所有回答写十段。'].flatMap(statement => [true, false].map(quoted => [statement, quoted] as const)))('does not admit a user profile through the work knowledge side channel: %s quoted=%s', (statement, quoted) => {
  const outputs = applyWorkCandidates({ candidates: [{ kind: 'note', topicKey: 'user-style', predicate: 'user.preference',
    statement, scope: 'workspace', confidence: 0.95, importance: 0.8, evidence: [{ ref: 'source', quote: '我喜欢冗长铺垫' }] }],
    evidence: [{ ref: 'source', role: 'user', text: quoted ? '请翻译客户原话：『我喜欢冗长铺垫』。' : '我喜欢冗长铺垫', createdAt: 1 }],
    conversationId: '', agentId: 'main', workspaceId: '/workspace', processingPolicy: 'local_only', runId: 'test' });
  expect(outputs[0]).toMatchObject({ outcome: 'rejected', reasonCode: quoted ? 'work_quote_not_owned' : 'personal_profile_requires_assertion' });
});
