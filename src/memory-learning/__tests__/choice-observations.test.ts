import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { writeKnowledgeItem } from '../../knowledge-memory/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { setSessionConfig } from '../../storage/sqlite/config-repository.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { deleteUserAssertion, listUserAssertions } from '../../user-model/repository.js';
import { listUserModelObservations } from '../../user-model/observation-repository.js';
import { parseUserModelInterpretation } from '../../user-model/capture/semantic.js';
import { executeUserModelInterpretation } from '../../user-model/capture/executor.js';
import { recordChoiceObservations, recallChoiceEvidence, forgetChoiceObservations } from '../choice-observations.js';

const first = '这组解释里，我选带简短标题的版本，这样容易扫读。';
const second = '看另一组例子，我还是选带简短标题的解释，这样读起来更顺。';
const config = ConfigSchema.parse({});
function turn(text: string) {
  const id = randomUUID();
  ensureSessionRecord(id, '/workspace', { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' });
  const row = appendTranscriptEntry(id, { role: 'user', content: text, timestamp: Date.now() });
  return { context: { conversationId: id, agentId: 'main', workspaceId: '/workspace' },
    evidence: [{ ref: row.entry_id, role: 'user' as const, text, createdAt: row.created_at }] };
}

describe('bounded cross-conversation choices', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog(); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
  it('retains one choice without asserting a preference, then recalls its original identity for a related later choice', () => {
    const a = turn(first); const b = turn(second);
    expect(recordChoiceObservations(config, a.context, a.evidence)).toBe(1);
    expect(listUserAssertions()).toEqual([]);
    expect(recordChoiceObservations(config, a.context, a.evidence)).toBe(1);
    expect(listUserModelObservations()).toHaveLength(1);
    expect(recallChoiceEvidence(config, b.context, b.evidence)).toEqual([
      { ...a.evidence[0], conversationId: a.context.conversationId, observationScope: { type: 'workspace', id: '/workspace' } },
    ]);
    expect(recallChoiceEvidence(config, b.context, [{ ...b.evidence[0], text: first }])).toEqual([]);
    expect(recallChoiceEvidence(config, b.context, [{ ...b.evidence[0], text: '请检查编译错误。' }])).toEqual([]);
    expect(recallChoiceEvidence(config, b.context, [{ ...b.evidence[0], text: second + '别记住这个选择。' }])).toEqual([]);
  });

  it.each(['agent', 'workspace', 'project', 'temporary', 'expired', 'changed', 'narrow', 'local_only'] as const)
    ('excludes %s sources before model access', variant => {
      const a = turn(first); const b = turn(second); recordChoiceObservations(config, a.context, a.evidence);
      const context = { ...b.context, ...(variant === 'agent' ? { agentId: 'other' } : {}),
        ...(variant === 'workspace' ? { workspaceId: '/other' } : {}), ...(variant === 'project' ? { projectId: 'other' } : {}) };
      const db = getSqliteDatabase();
      if (variant === 'temporary') setSessionConfig(a.context.conversationId, { userContextMode: 'temporary' });
      if (variant === 'expired') db.prepare('UPDATE user_model_observations SET delete_after=1').run();
      if (variant === 'changed') db.prepare("UPDATE transcript_entries SET payload_json=json_set(payload_json,'$.content','changed source') WHERE entry_id=?").run(a.evidence[0].ref);
      if (variant === 'local_only') db.prepare("UPDATE context_evidence SET processing_policy='local_only'").run();
      if (variant === 'narrow') writeKnowledgeItem({ kind: 'note', scope: { type: 'session', id: a.context.conversationId },
        content: 'A session-only note.', canonicalKey: 'narrow', originClass: 'owner', confidence: 1, importance: 0.5,
        evidence: [{ id: listUserModelObservations()[0].evidenceId! }] });
      expect(recallChoiceEvidence(config, context, b.evidence)).toEqual([]);
    });

  it.each(['今天临时我选简短标题的版本。', '> 我选简短标题的版本。', '假设我选简短标题的版本。', '我选简短标题。请忘记这个偏好。', '我选带简短标题的版本，但别记住这个选择。'])
    ('does not retain non-durable or non-owned choices: %s', text => {
      const source = turn(text); recordChoiceObservations(config, source.context, source.evidence);
      expect(listUserModelObservations()).toEqual([]);
    });

  it('forgets pending choices and prevents old transcript replays from recreating them', () => {
    const a = turn(first); const b = turn(second); recordChoiceObservations(config, a.context, a.evidence);
    forgetChoiceObservations(b.context);
    expect(recordChoiceObservations(config, a.context, a.evidence)).toBe(0);
    expect(recallChoiceEvidence(config, b.context, b.evidence)).toEqual([]);
  });

  it.each([false, true])('preserves provenance and prevents a scope widening: global=%s', global => {
    const a = turn(first); const b = turn(second); recordChoiceObservations(config, a.context, a.evidence);
    const carried = recallChoiceEvidence(config, b.context, b.evidence);
    const evidence = [...carried, ...b.evidence];
    const raw = JSON.stringify({ intent: 'none', targetAssertionIds: [], assertions: [{ intent: 'user_assertion', action: 'create',
      subject: { type: 'user', id: 'self' }, predicate: 'preference.response.headings', cardinality: 'single',
      scope: global ? { type: 'global' } : { type: 'workspace', id: '/workspace' }, kind: 'preference', value: 'short headings', normalizedValue: 'short headings',
      statement: 'Prefers explanations with short headings.', authority: 'user_observed', confidence: 0.75, inferredImportance: 0.5,
      consequence: 'low', actionability: 1, volatility: 'slow', sensitivity: 'normal', disclosurePolicy: 'referenceable', temporalResolution: 'exact',
      selfContained: true, unresolvedReferences: [], evidence: evidence.map(e => ({ ref: e.ref, quote: e.text })) }] });
    const interpretation = parseUserModelInterpretation(raw, evidence)!;
    const result = executeUserModelInterpretation({ interpretation, evidence, extractionRunId: 'test', extractorId: 'test',
      scopeContext: b.context, policy: { write: 'allow', sensitiveWrite: 'confirm', processing: 'remote_allowed' } });
    if (global) {
      expect(result.outputs[0].reasonCode).toBe('observation_scope_or_authority'); return;
    }
    expect(result.createdAssertions).toHaveLength(1);
    const linked = getSqliteDatabase().prepare(`SELECT conversation_id,message_id FROM context_evidence WHERE evidence_id IN (
      SELECT evidence_id FROM user_assertion_evidence WHERE assertion_id=?)`).all(result.createdAssertions[0].id);
    expect(linked).toEqual(expect.arrayContaining([
      { conversation_id: a.context.conversationId, message_id: a.evidence[0].ref },
      { conversation_id: b.context.conversationId, message_id: b.evidence[0].ref },
    ]));
    deleteUserAssertion(result.createdAssertions[0].id);
    expect(listUserModelObservations()).toEqual([]);
    expect(recordChoiceObservations(config, a.context, a.evidence)).toBe(0);
  });
});
