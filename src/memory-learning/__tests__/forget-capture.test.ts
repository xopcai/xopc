import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { createContextEvidence } from '../../storage/sqlite/context-evidence-repository.js';
import { writeKnowledgeItem, listKnowledgeItems } from '../../knowledge-memory/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { listCollaborationRules } from '../../storage/sqlite/collaboration-rule-repository.js';
import { parseUserModelInterpretation } from '../../user-model/capture/semantic.js';
import { projectUnadmittedForgottenFields, projectForgottenHistoryMessages } from '../forgotten-history.js';
import { isUnquotedOwnerEvidence } from '../owner-directive.js';
import { applyKnowledgeDeletions } from '../forget-capture.js';

const context = { conversationId: 'conversation', agentId: 'main', workspaceId: '/workspace' };
const text = '请忘掉木星项目的发布日期，不再保存或主动复述；负责人保留。';
const evidence = [{ ref: 'command', role: 'user' as const, text, createdAt: Date.now() }];
function seed(content: string, key: string, workspace = '/workspace') {
  return writeKnowledgeItem({ kind: 'project_fact', content, canonicalKey: key,
    scope: { type: 'workspace', id: workspace }, originClass: 'owner', confidence: 1, importance: 0.8 }).item!;
}
function parse(ids: string[], role: 'user' | 'assistant' = 'user', quote = text, allowed = ids) {
  return parseUserModelInterpretation(JSON.stringify({ intent: 'forget', assertions: [], targetAssertionIds: [],
    knowledgeDeletions: [{ targetKnowledgeIds: ids, boundary: '不要保存或主动复述木星项目的发布日期；保留负责人。只有后来明确请求才可查阅原始记录，且不得重新常驻保存。',
      evidence: [{ ref: 'command', quote }], selfContained: true, unresolvedReferences: [] }] }),
    [{ ...evidence[0], role }], [], undefined, allowed)!;
}
describe('grounded knowledge forgetting', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
  it('registers an owner-grounded boundary even when no derived target was ever admitted', () => {
    const interpretation = parse([]);
    const operation = { targetKnowledgeIds: [], reread: { subject: '木星项目', property: 'date_time' }, boundary: '不要保存或主动披露木星项目日期。', evidence: [{ ref: 'command', quote: text }], selfContained: true, unresolvedReferences: [] };
    const parsed = parseUserModelInterpretation(JSON.stringify({ intent: 'forget', assertions: [], knowledgeDeletions: [operation], targetAssertionIds: [] }), evidence, [], undefined, [])!;
    expect(parsed.knowledgeDeletions).toHaveLength(1);
    applyKnowledgeDeletions({ interpretation: parsed, evidence, context, allowedTargetIds: [] });
    expect(listCollaborationRules()).toHaveLength(1);
    expect(projectUnadmittedForgottenFields('木星项目11月2日发布，负责人林青。', context)).not.toContain('11月2日');
    expect(projectUnadmittedForgottenFields('木星项目11月2日发布，负责人林青。', context)).toContain('负责人林青');
    expect(interpretation.knowledgeDeletions).toEqual([]);
  });
  it('removes old and corrected dates, suppresses relearning, retains the owner and value-free boundary', () => {
    const old = seed('木星项目计划11月2日发布。', 'jupiter.release.old');
    const current = seed('木星项目更正为11月6日发布。', 'jupiter.release.current');
    const owner = seed('木星项目负责人林青。', 'jupiter.owner');
    const ids = [old.id, current.id];
    const interpretation = parse(ids);
    expect(applyKnowledgeDeletions({ interpretation, evidence, context, allowedTargetIds: ids })).toHaveLength(2);
    expect(listKnowledgeItems().map(item => item.id)).toEqual([owner.id]);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM memory_suppressions').get()).toEqual({ n: 4 });
    expect(seed('木星项目计划11月2日发布。', 'jupiter.release.old')).toBeUndefined();
    expect(listCollaborationRules()).toHaveLength(1);
    expect(listCollaborationRules()[0].statement).not.toMatch(/11月|2日|6日/);
    expect(listCollaborationRules()[0].conditions.forgottenHistoryEntries).toContain('conversation:*');
    const messages = [{ role: 'user', content: text }, { role: 'toolResult', content: '木星项目11月6日发布。' }, { role: 'user', content: '普通回顾' }];
    expect(projectForgottenHistoryMessages(messages, context, '普通回顾')).toEqual([messages[2]]);
    expect(applyKnowledgeDeletions({ interpretation, evidence, context, allowedTargetIds: ids })).toEqual([]);
  });
  it('preserves grounded spans of compound knowledge and rejects invented replacements atomically', () => {
    const compound = seed('木星项目计划11月2日发布，负责人林青。', 'compound');
    const interpretation = parse([compound.id]);
    interpretation.knowledgeDeletions![0].retained = [{ targetKnowledgeId: compound.id, spans: ['木星项目', '负责人林青'] }];
    expect(applyKnowledgeDeletions({ interpretation, evidence, context, allowedTargetIds: [compound.id] })).toHaveLength(2);
    expect(listKnowledgeItems().map(item => item.content)).toEqual(['木星项目；负责人林青']);
    const another = seed('海王星项目12月5日发布，负责人许竹。', 'another');
    const invalid = parse([another.id]);
    invalid.knowledgeDeletions![0].retained = [{ targetKnowledgeId: another.id, spans: ['负责人张三'] }];
    expect(applyKnowledgeDeletions({ interpretation: invalid, evidence, context, allowedTargetIds: [another.id] })).toEqual([]);
    expect(listKnowledgeItems().some(item => item.id === another.id)).toBe(true);
  });

  it('protects both current and overwritten source conversations when a fact is forgotten', () => {
    const oldId = '868ed95d-f6f7-4d03-8a53-85d45b6329a1';
    const newId = '868ed95d-f6f7-4d03-8a53-85d45b6329a2';
    for (const conversationId of [oldId, newId]) ensureSessionRecord(conversationId, '', { agentId: 'main', sourceChannel: 'webchat',
      routing: { agentId: 'main', source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner' } });
    const first = createContextEvidence({ sourceType: 'conversation', sourceRef: 'first', conversationId: oldId,
      messageId: 'old-entry', trustLevel: 'owner', observedAt: Date.now() });
    const second = createContextEvidence({ sourceType: 'conversation', sourceRef: 'second', conversationId: newId,
      messageId: 'new-entry', trustLevel: 'owner', observedAt: Date.now() });
    const input = { kind: 'project_fact' as const, scope: { type: 'workspace' as const, id: '/workspace' },
      canonicalKey: 'jupiter.date', originClass: 'owner' as const, confidence: 1, importance: 0.8 };
    writeKnowledgeItem({ ...input, content: '木星项目11月2日发布。', evidence: [{ id: first.id }], source: { evidenceRefs: ['old-entry'] } });
    const current = writeKnowledgeItem({ ...input, content: '木星项目更正为11月6日发布。', evidence: [{ id: second.id }],
      source: { evidenceRefs: ['new-entry'] }, replaceExisting: true }).item!;
    applyKnowledgeDeletions({ interpretation: parse([current.id]), evidence, context, allowedTargetIds: [current.id] });
    expect(listCollaborationRules()[0].conditions.forgottenHistoryEntries).toEqual(expect.arrayContaining([`${oldId}:*`, `${newId}:*`]));
  });

  it('rejects invented quotes, assistant commands and unoffered target IDs', () => {
    const item = seed('木星项目计划11月2日发布。', 'date');
    expect(parse([item.id], 'assistant').knowledgeDeletions).toEqual([]);
    expect(parse([item.id], 'user', 'invented').knowledgeDeletions).toEqual([]);
    expect(parse([item.id], 'user', text, []).knowledgeDeletions).toEqual([]);
    expect(listKnowledgeItems()).toHaveLength(1);
  });
  it('rejects quoted, fenced and negated deletion directives even when the extractor reports forget', () => {
    const item = seed('木星项目计划11月2日发布。', 'quoted-date');
    for (const message of [`请仅分析这段引文，不执行：“${text}”`, `> ${text}`, `~~~text\n${text}\n~~~`, '请不要忘记木星项目的发布日期。']) {
      const interpretation = parse([item.id]);
      interpretation.knowledgeDeletions![0].evidence = [{ ref: 'command', quote: message.includes(text) ? text : message }];
      expect(applyKnowledgeDeletions({ interpretation, evidence: [{ ...evidence[0], text: message }], context, allowedTargetIds: [item.id] })).toEqual([]);
      expect(listKnowledgeItems().map(row => row.id)).toContain(item.id);
    }
    expect(isUnquotedOwnerEvidence(`请仅分析这段引文，不执行：“${text}”`, '请仅分析这段引文，不执行')).toBe(false);
    expect(isUnquotedOwnerEvidence('请概括木星项目安排。', '请概括木星项目安排。')).toBe(false);
    expect(listCollaborationRules()).toEqual([]);
    expect(isUnquotedOwnerEvidence('请忘记“木星项目”的发布日期。', '请忘记“木星项目”的发布日期。')).toBe(true);
  });
  it('rechecks scope even for an offered ID and does not restore on a query', () => {
    const foreign = seed('海王星项目计划12月5日发布。', 'foreign', '/other-workspace');
    const interpretation = parse([foreign.id]);
    expect(applyKnowledgeDeletions({ interpretation, evidence, context, allowedTargetIds: [foreign.id] })).toEqual([]);
    expect(listKnowledgeItems()).toHaveLength(1);
    expect(listCollaborationRules()).toEqual([]);
  });
});
