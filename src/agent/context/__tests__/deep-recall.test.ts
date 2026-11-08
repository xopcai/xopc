import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, realpathSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { ProjectStore } from '../../../projects/project-store.js';
import { canRecallConversation, canRecallHistoryEntry } from '../../../session/history-recall-policy.js';
import { createSessionSearchTool } from '../../tools/session-search-tool.js';
import { ExecutionContextCoordinator } from '../coordinator.js';
import { resolveUserContextSessionAccess } from '../../../user-context/access-policy.js';
import { AgentManager } from '../../agent-manager.js';
import { ConfigSchema } from '../../../config/schema.js';
import { writeKnowledgeItem } from '../../../knowledge-memory/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, createCollaborationRule } from '../../../storage/sqlite/index.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { appendTranscriptEntry, searchSessionTranscript } from '../../../storage/sqlite/transcript-repository.js';
import { setSessionConfig as setConfig } from '../../../storage/sqlite/config-repository.js';
import type { SessionStore } from '../../../session/store.js';
import { buildExecutionContext, fitExecutionContextToChars } from '../execution-context.js';
import { deepenExecutionContext, deepRecallReason } from '../deep-recall.js';
import { recordExecutionContext, getExecutionContextAudit } from '../audit.js';

const corpus = JSON.parse(readFileSync(new URL('../../../../evals/memory/recall-cases.json', import.meta.url), 'utf8'));
const uuid = (label: string) => { const h = createHash('sha256').update(label).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const setSessionConfig = (id: string, ...args: Parameters<typeof setConfig> extends [string, ...infer Rest] ? Rest : never) => setConfig(uuid(id), ...args);
const request = { query: '', agentId: 'main', workspaceId: '/recall', conversationId: uuid('query'),
  knowledgePolicy: { scopes: ['global', 'agent', 'workspace', 'project', 'session'] as const, contentSources: ['memory'] as const } };
const text = (value: string) => value.replaceAll('{tag}', 'eval');
const store = { recallSession: searchSessionTranscript } as SessionStore;
function session(id: string, workspace = '/recall', agentId = 'main') {
  createConversation({ agentId, sourceChannel: 'webchat' }, workspace, uuid(id));
}
function append(id: string, content: string) {
  return appendTranscriptEntry(uuid(id), { role: 'user', content, timestamp: Date.now() });
}
async function recall(question: string, queries: string[] = ['发布 分支'], overrides: Partial<Parameters<typeof deepenExecutionContext>[0]> = {}) {
  const input = { ...request, query: question };
  return deepenExecutionContext({ config: structuredClone(ConfigSchema.parse({})), context: buildExecutionContext(input), request: input,
    recent: [], store, planQueries: vi.fn().mockResolvedValue(queries), ...overrides });
}

describe('bounded on-demand recall', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog(); session('query');
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

  it.each(corpus.cases)('retrieves expected original evidence: $id', async testCase => {
    for (const source of corpus.sources) { session(source.id); append(source.id, text(source.text)); }
    const result = await recall(text(testCase.question), testCase.queries, { recent: testCase.recent ?? [] });
    expect(result.recall?.status).not.toBe('failed');
    for (const source of testCase.expectedSources) expect(result.recall?.evidence.some(item => item.conversationId === uuid(source))).toBe(true);
    for (const item of result.recall?.evidence ?? []) expect(corpus.sources.some(source => text(source.text).includes(item.quote))).toBe(true);
    const fitted = fitExecutionContextToChars(result, 6000);
    expect(fitted.rendered.length).toBeLessThanOrEqual(6000);
    for (const source of testCase.expectedSources) expect(fitted.context.recall?.evidence.some(item => item.conversationId === uuid(source))).toBe(true);
  });

  it('skips ordinary turns, explicit mutations and strong direct matches without calling a model', async () => {
    const plan = vi.fn();
    for (const query of ['你好', '写一个排序函数', '请记住我喜欢简洁回答', '纠正发布分支为stable']) {
      expect((await recall(query, [], { planQueries: plan })).recall).toBeUndefined();
    }
    expect(plan).not.toHaveBeenCalled();
    writeKnowledgeItem({ kind: 'workspace_fact', scope: { type: 'workspace', id: '/recall' }, content: '发布分支是什么 stable', canonicalKey: 'branch', originClass: 'owner', confidence: 1, importance: 0.8 });
    const context = buildExecutionContext({ ...request, query: '发布分支是什么' });
    expect(deepRecallReason('发布分支是什么', context)).toBeUndefined();
  });

  it('keeps broad source scopes and forgotten material out of automatic history', async () => {
    for (const id of ['allowed', 'other-workspace', 'temporary', 'session-only', 'forgotten']) session(id, id === 'other-workspace' ? '/elsewhere' : '/recall');
    append('allowed', '此前发布分支为stable，原因是保护规则');
    append('other-workspace', '此前发布分支为LEAK-WORKSPACE');
    append('temporary', '此前发布分支为LEAK-TEMP'); setSessionConfig('temporary', { userContextMode: 'temporary' }, '/recall');
    append('session-only', '仅在当前会话记住：此前发布分支为LEAK-SESSION');
    append('forgotten', '此前发布分支为LEAK-FORGOTTEN');
    createCollaborationRule({ category: 'boundary', priority: 10, scope: { type: 'global' }, status: 'active',
      statement: 'Do not recover forgotten source', conditions: { forgottenHistoryEntries: [`${uuid('forgotten')}:*`] }, evidenceRefs: [] });
    const result = await recall('之前发布分支是什么？');
    expect(result.recall?.evidence.map(item => item.conversationId)).toEqual([uuid('allowed')]);
    const denied = structuredClone(ConfigSchema.parse({})); denied.userContext.knowledgeMemory.readScopes = ['global'];
    expect((await recall('之前发布分支是什么？', undefined, { config: denied })).recall?.evidence).toEqual([]);
    const temporary = structuredClone(ConfigSchema.parse({})); setSessionConfig('query', { userContextMode: 'temporary' }, '/recall');
    const plan = vi.fn(); expect((await recall('之前发布分支是什么？', undefined, { config: temporary, planQueries: plan })).recall).toBeUndefined();
    expect(plan).not.toHaveBeenCalled();
  });

  it('reads a nearby owner explanation and never treats the current question as evidence', async () => {
    session('source'); append('source', '之前发布分支是stable');
    append('source', '因为新的保护规则只覆盖这条线');
    append('query', '之前发布分支是什么？');
    const result = await recall('之前发布分支是什么？');
    expect(result.recall?.evidence.map(item => item.quote)).toContain('因为新的保护规则只覆盖这条线');
    expect(result.recall?.evidence.some(item => item.conversationId === uuid('query'))).toBe(false);
  });

  it('finds matching old conversations beyond the recent-session cap', async () => {
    session('old-source'); append('old-source', '此前发布分支是stable');
    for (let i = 0; i < 70; i++) { session(`noise-${i}`); append(`noise-${i}`, '无关的午餐记录'); }
    const config = structuredClone(ConfigSchema.parse({})); config.userContext.contextPlanning.deepRecall.maxSessions = 2;
    expect((await recall('之前发布分支是什么？', undefined, { config })).recall?.evidence.some(item => item.conversationId === uuid('old-source'))).toBe(true);
  });

  it('uses the persisted workspace before in-memory session hydration', () => {
    setSessionConfig('query', { workingDirectoryOverride: '/persisted-project' }, '/recall');
    const manager = Object.create(AgentManager.prototype) as AgentManager;
    (manager as unknown as { sessionWorkspaceOverrides: Map<string, string> }).sessionWorkspaceOverrides = new Map();
    expect(manager.getResolvedWorkspaceForSession(uuid('query'))).toBe('/persisted-project');
  });

  it('strips device envelopes and withholds forgotten recent queries from the planner', async () => {
    session('source');
    append('source', '<source_contexts>device-private-field</source_contexts>\n\n<user_message>\n[2026-11-08 17:24 GMT+8] 之前发布分支为stable\n</user_message>');
    const result = await recall('之前发布分支是什么？');
    expect(result.recall?.evidence[0]?.quote).toBe('之前发布分支为stable');
    createCollaborationRule({ category: 'boundary', priority: 10, scope: { type: 'global' }, status: 'active',
      statement: 'Do not recover forgotten query', conditions: { forgottenHistoryEntries: [`${uuid('query')}:*`] }, evidenceRefs: [] });
    const plan = vi.fn().mockResolvedValue(['发布 分支']);
    await recall('之前发布分支是什么？', [], { recent: ['记住密码为FORGOTTEN'], planQueries: plan });
    expect(plan).toHaveBeenCalledWith('之前发布分支是什么？', [], expect.any(AbortSignal));
  });

  it('matches workspace aliases through the existing canonical path policy', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-recall-alias-'));
    try {
      const alias = `${directory}-alias`; symlinkSync(directory, alias, 'dir');
      try {
        session('alias-source', alias); append('alias-source', '之前发布分支为stable');
        const input = { ...request, query: '之前发布分支是什么？', workspaceId: realpathSync(directory) };
        const result = await recall(input.query, ['发布 分支'], { request: input, context: buildExecutionContext(input) });
        expect(result.recall?.evidence.some(item => item.conversationId === uuid('alias-source'))).toBe(true);
      } finally { rmSync(alias, { force: true }); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('does not leak context when temporary mode is enabled during query planning', async () => {
    const result = await recall('之前发布分支是什么？', [], { planQueries: async () => {
      setSessionConfig('query', { userContextMode: 'temporary' }, '/recall'); return ['发布 分支'];
    } });
    expect(result.recall).toBeUndefined(); expect(result.knowledge).toEqual([]); expect(result.assertions).toEqual([]);
  });

  it('also withholds forgotten recent queries before external retrieval and task assembly', async () => {
    const config = structuredClone(ConfigSchema.parse({})); config.userContext.knowledgeMemory.contentSources.push('connector');
    const search = vi.fn().mockResolvedValue([]);
    const coordinator = new ExecutionContextCoordinator({ getConfig: () => config,
      getAccessForSession: id => resolveUserContextSessionAccess(config, id),
      getWorkspaceIdForSession: () => '/recall', getProjectIdForSession: () => undefined,
      ensureMemoryReady: async () => {}, searchExternalMemory: search });
    await coordinator.prepare({ role: 'user', content: '发布约定是FORGOTTEN-VALUE', timestamp: 1 }, uuid('query'), 'before-forget');
    createCollaborationRule({ category: 'boundary', priority: 10, scope: { type: 'global' }, status: 'active',
      statement: 'Forget old source', conditions: { forgottenHistoryEntries: [`${uuid('query')}:*`] }, evidenceRefs: [] });
    await coordinator.prepare({ role: 'user', content: '之前的发布约定是什么？', timestamp: 2 }, uuid('query'), 'after-forget');
    expect(search.mock.calls.at(-1)?.[0].query).not.toContain('FORGOTTEN-VALUE');
  });

  it('uses the same boundary for fallback session_search, including recent titles and assistant echoes', async () => {
    const config = structuredClone(ConfigSchema.parse({}));
    const project = new ProjectStore().create({ name: 'Other', workspaceRoot: '/recall' });
    createConversation({ agentId: 'main', sourceChannel: 'webchat', projectId: project.id }, '/recall', uuid('other-project'));
    append('other-project', '之前发布分支为LEAK-PROJECT');
    session('narrow-source'); append('narrow-source', '仅在当前会话记住：发布分支为LEAK-SESSION');
    appendTranscriptEntry(uuid('narrow-source'), { role: 'assistant', content: '已记住LEAK-SESSION', timestamp: Date.now() } as never);
    session('allowed'); append('allowed', '之前发布分支为stable');
    const sourceStore = { recallSession: searchSessionTranscript,
      list: async () => ({ items: ['other-project', 'narrow-source', 'allowed'].map(id => ({ key: uuid(id), name: `title-${id}` })), total: 3 }) } as unknown as SessionStore;
    const tool = createSessionSearchTool({ localOnly: true, getSessionStore: () => sourceStore,
      getPrimaryModel: vi.fn(), getCurrentConversationId: () => request.conversationId, getHistoryContext: () => request,
      canRecallConversation: id => canRecallConversation(config, request, id),
      canRecallEntry: (id, entryId, content) => canRecallHistoryEntry(request, id, entryId, content) });
    for (const params of [{ query: '发布 分支' }, {}]) {
      const result = await tool.execute('scope', params);
      const payload = JSON.parse((result.content[0] as { text: string }).text);
      expect(JSON.stringify(payload)).not.toMatch(/LEAK|other-project|narrow-source/u);
      const ids = payload.results.map(item => item.conversationId ?? item.key);
      expect(ids).toEqual([uuid('allowed')]);
    }
  });

  it('bounds a stalled planner, fails open and records the failure in context audit', async () => {
    const config = structuredClone(ConfigSchema.parse({})); config.userContext.contextPlanning.deepRecall.timeoutMs = 100;
    const result = await recall('之前发布分支是什么？', [], { config, planQueries: () => new Promise(() => {}) });
    expect(result.recall?.status).toBe('failed');
    const fitted = fitExecutionContextToChars(result, 6000);
    recordExecutionContext(result, { turnId: 'timeout', conversationId: uuid('query'), budget: { maxAssertions: 20, maxKnowledge: 12, maxChars: 6000 }, renderedChars: fitted.rendered.length, includedContext: fitted.context });
    expect(getExecutionContextAudit('timeout')?.metrics).toMatchObject({ recallFailed: 1, recallModelCalls: 1, includedRecallEvidence: 0 });
  });
});
