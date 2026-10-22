import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createCollaborationRule } from '../../storage/sqlite/collaboration-rule-repository.js';
import { createSessionSearchTool } from '../../agent/tools/session-search-tool.js';
import { createSessionRecallTool } from '../../agent/tools/session-recall-tool.js';
import { explicitlyReadsOriginalHistory } from '../forgotten-history.js';

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
});
