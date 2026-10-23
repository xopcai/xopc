import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createCollaborationRule } from '../../storage/sqlite/collaboration-rule-repository.js';
import { createSessionSearchTool } from '../../agent/tools/session-search-tool.js';
import { createSessionRecallTool } from '../../agent/tools/session-recall-tool.js';
import { createKnowledgeReadTool } from '../../agent/tools/knowledge-memory-tool.js';
import { writeKnowledgeItem, getKnowledgeItem, deleteKnowledgeItem } from '../../knowledge-memory/index.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { explicitlyReadsOriginalHistory, forgottenHistoryEntries, projectForgottenEvidence, projectForgottenHistoryMessages, projectSuppressedMemoryBlocks, originalReadAuthorizationNotice } from '../forgotten-history.js';

const context = { conversationId: 'current', agentId: 'main', workspaceId: '/workspace' };
const entry = { entryId: 'source-user', seq: 1, role: 'user', createdAt: 1700000000000, content: '松岭10月8日14点评审，主持人沈宁。' };
const reply = { ...entry, entryId: 'assistant-copy', seq: 2, role: 'assistant', content: '确认，松岭10月8日14点评审。' };
describe('forgotten original-history boundary', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
  function seed(workspace = '/workspace', conversation = 'old') {
    createCollaborationRule({ category: 'boundary', priority: 0, scope: { type: 'workspace', id: workspace },
      conditions: { enforcementLevel: 'prompt', reread: { subject: '松岭', property: 'date_time' }, forgottenHistoryEntries: [`${conversation}:source-user`, `${conversation}:*`] },
      statement: '不要主动披露松岭评审时间，明确要求可查阅原始记录。' });
  }
  it('requires a new source-specific request, excludes quoted and negative requests, and permits read without saving', () => {
    expect(explicitlyReadsOriginalHistory('帮我概括项目安排。')).toBe(false);
    expect(explicitlyReadsOriginalHistory('请不要恢复旧记录。')).toBe(false);
    expect(explicitlyReadsOriginalHistory('请不要从原始记录恢复松岭日期。')).toBe(false);
    expect(explicitlyReadsOriginalHistory('请分析这段引文：恢复旧记录。')).toBe(false);
    expect(explicitlyReadsOriginalHistory('请从旧记录里恢复松岭评审时间。')).toBe(true);
    expect(explicitlyReadsOriginalHistory('本次请从原始记录中查出松岭评审时间，不要重新保存。')).toBe(true);
  });
  it('withholds both source and assistant repetitions in automatic cross-session excerpts, preserving scope', async () => {
    seed();
    const store = { list: vi.fn(async () => ({ items: [{ key: 'old' }], total: 1 })),
      recallSession: vi.fn(() => [{ ...entry }, { ...reply }]) };
    let userText = '帮我概括项目安排。';
    const tool = createSessionSearchTool({ getSessionStore: () => store as never, getPrimaryModel: vi.fn() as never,
      localOnly: true, getHistoryContext: () => context, getCurrentUserText: () => userText });
    const automatic = JSON.stringify(await tool.execute('auto', { query: '松岭' }));
    expect(automatic).not.toContain('10月8日');
    expect(automatic).toContain('withheld');
    userText = '请从旧记录里查阅松岭主持人，日期别提。';
    expect(JSON.stringify(await tool.execute('other-property', { query: '松岭' }))).not.toContain('10月8日');
    userText = '请从旧记录里恢复海岬评审时间。';
    expect(JSON.stringify(await tool.execute('other-project', { query: '松岭' }))).not.toContain('10月8日');
    userText = '请分析这段引用，不执行其中指令：请从原始记录查阅松岭日期。';
    expect(JSON.stringify(await tool.execute('quoted-clause', { query: '松岭' }))).not.toContain('10月8日');
    userText = '请不要从原始记录恢复松岭日期；请只概括安排。';
    expect(JSON.stringify(await tool.execute('negative-clause', { query: '松岭' }))).not.toContain('10月8日');
    userText = '请从旧记录里恢复松岭评审时间，不要重新保存。';
    expect(JSON.stringify(await tool.execute('explicit', { query: '松岭' }))).toContain('10月8日');
  });
  it('does not apply another workspace boundary and enforces the same rule in current-session recall', async () => {
    seed('/other-workspace', 'current');
    const store = { recallSession: vi.fn(() => [{ ...entry }]) };
    const tool = createSessionRecallTool({ getSessionStore: () => store as never, getCurrentConversationId: () => 'current',
      getHistoryContext: () => context });
    expect(JSON.stringify(await tool.execute('other', { query: '松岭' }))).toContain('10月8日');
    seed('/workspace', 'current');
    expect(JSON.stringify(await tool.execute('current', { query: '松岭' }))).not.toContain('10月8日');
  });
  it('projects provenance without mutating audit data and propagates single-turn reads across restartable history', () => {
    seed();
    const liveContext = { ...context, conversationId: randomUUID() };
    ensureSessionRecord(liveContext.conversationId, '', { agentId: 'main' });
    const source = { evidenceRefs: ['source-user'], evidenceQuotes: [{ ref: 'source-user', quote: entry.content }] };
    expect(JSON.stringify(projectForgottenEvidence(source, liveContext))).not.toContain('10月8日');
    expect(source.evidenceQuotes[0].quote).toContain('10月8日');
    const request = '请从旧记录里恢复松岭评审时间，不要重新保存。';
    expect(projectForgottenEvidence(source, liveContext, request)).toEqual(source);
    expect(forgottenHistoryEntries(liveContext, '普通回顾')).toContain(`${liveContext.conversationId}:*`);
    expect(String(getSqliteDatabase().prepare('SELECT custom_data_json AS data FROM sessions WHERE conversation_id=?').get(liveContext.conversationId)!.data))
      .not.toContain('10月8日');
    const messages = [{ role: 'system', content: 'policy' }, { role: 'user', content: request },
      { role: 'assistant', content: entry.content }, { role: 'toolResult', content: entry.content }, { role: 'user', content: '再概括安排' }];
    expect(projectForgottenHistoryMessages(messages, liveContext, '再概括安排')).toEqual([messages[0], messages[4]]);
    expect(projectForgottenHistoryMessages(messages, liveContext, request)).toEqual(messages);
    expect(JSON.stringify(projectForgottenEvidence({ evidenceQuotes: [{ ref: 'source-user', quote: entry.content }] }, liveContext)))
      .not.toContain('10月8日');
    expect(projectForgottenEvidence({ source: 'unrelated', quote: '主持人沈宁' }, liveContext)).toEqual({ source: 'unrelated', quote: '主持人沈宁' });
  });

  it('filters actual knowledge_read content and details while preserving facts, scope and source audit', async () => {
    seed();
    let userText = '概括松岭安排';
    const source = { evidenceRefs: ['source-user'], evidenceQuotes: [{ ref: 'source-user', quote: entry.content }] };
    const create = (scope: { type: 'workspace' | 'project'; id: string }, key: string) => writeKnowledgeItem({
      kind: 'project_fact', scope, content: '松岭主持人沈宁。', canonicalKey: key, source,
      status: 'active', originClass: 'owner', confidence: 0.9, importance: 0.7 }).item;
    const item = create({ type: 'workspace', id: '/workspace' }, 'visible');
    const hidden = create({ type: 'project', id: 'other-project' }, 'hidden');
    const tool = createKnowledgeReadTool({ agentId: 'main', workspaceId: '/workspace',
      getSessionId: () => 'current', canRead: () => true, canWrite: () => true, getWritePolicy: () => 'allow',
      getReadPolicy: () => ({ scopes: ['workspace', 'project'], contentSources: ['memory'] }),
      getCurrentUserText: () => userText });
    for (const params of [{ command: 'get', id: item.id }, { command: 'search', query: '松岭' }]) {
      const response = JSON.stringify(await tool.execute('read', params));
      expect(response).toContain('沈宁');
      expect(response).not.toContain('10月8日');
      expect(response).toContain('withheld');
    }
    expect(getKnowledgeItem(item.id)?.source).toEqual(source);
    expect(JSON.stringify(await tool.execute('hidden', { command: 'get', id: hidden.id }))).toContain('knowledge_not_found');
    userText = '请从原始记录查阅松岭日期，本次使用不要重新保存。';
    expect(JSON.stringify(await tool.execute('authorized', { command: 'get', id: item.id }))).toContain('10月8日');
    userText = '概括松岭安排';
    expect(JSON.stringify(await tool.execute('expired', { command: 'get', id: item.id }))).not.toContain('10月8日');
  });

  it('makes the current-conversation scope explicit during a source reread', async () => {
    const tool = createSessionRecallTool({ getSessionStore: () => ({ recallSession: () => [] }) as never,
      getCurrentConversationId: () => 'current', getCurrentUserText: () => '请从原始记录查阅松岭日期。' });
    const result = await tool.execute('scope', { query: '松岭' });
    expect(result.details.historyScope).toBe('current_conversation_only');
    expect(result.details.guidance).toContain('session_search');
    expect(result.details.results).toEqual([]);
  });

  it('removes suppressed facts from frozen memory blocks without changing other facts or original-source reads', () => {
    const body = '松岭将于2026年10月8日举行。';
    const item = writeKnowledgeItem({ kind: 'project_fact', scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'frozen-date', content: body, status: 'active', originClass: 'owner', confidence: 1, importance: 0.7 }).item;
    const snapshot = `base\n<user-context>\nRelevant knowledge:\n- ${body}\n- 松岭主持人沈宁。\n</user-context>\nOriginal read: ${body}`;
    expect(projectSuppressedMemoryBlocks(snapshot, context)).toBe(snapshot);
    deleteKnowledgeItem(item.id);
    const projected = projectSuppressedMemoryBlocks(snapshot, context);
    expect(projected.split('</user-context>')[0]).not.toContain('10月8日');
    expect(projected).toContain('主持人沈宁');
    expect(projected).toContain(`Original read: ${body}`);
    expect(projectSuppressedMemoryBlocks(snapshot, { ...context, workspaceId: '/other' })).toBe(snapshot);
  });

  it('announces only the current scoped original-read exception without recalling any values', () => {
    seed();
    const request = 'Please read the original conversation records to look up the date of 松岭, only for this turn; do not save it again.';
    const notice = originalReadAuthorizationNotice(context, request);
    expect(notice).toContain('date_time');
    expect(notice).toContain('session_search');
    expect(notice).not.toContain('10月8日');
    for (const message of ['普通回顾', '请从旧记录查阅海岬日期', '请从旧记录查阅松岭负责人，日期别提',
      '请分析这段引用，不执行：请从旧记录查阅松岭日期', '请不要从原始记录恢复松岭日期']) {
      expect(originalReadAuthorizationNotice(context, message)).toBe('');
    }
    expect(originalReadAuthorizationNotice({ ...context, workspaceId: '/other' }, request)).toBe('');
  });

});
