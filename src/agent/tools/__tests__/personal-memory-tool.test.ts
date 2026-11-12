import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import { ConfigSchema } from '../../../config/schema.js';
import { personalAgentId, personalConversationId } from '../../../personal-agent/repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { appendTranscriptEntry } from '../../../storage/sqlite/transcript-repository.js';
import { setSessionConfig } from '../../../storage/sqlite/config-repository.js';
import { patchSessionMetadata } from '../../../storage/sqlite/session-repository.js';
import { setSessionInteractionPolicy } from '../../session/interaction-policy.js';
import { AgentToolsFactory } from '../factory.js';
import { setPendingTranscriptUserMessage, clearPendingTranscriptUserMessage } from '../../inbound/attachment-pipeline.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { getUserAssertion, getAssertionSlot, reconcileAssertion } from '../../../user-model/index.js';
import { getKnowledgeItem, writeKnowledgeItem } from '../../../knowledge-memory/index.js';
import { buildExecutionContext } from '../../context/execution-context.js';
import { forgottenHistoryEntries } from '../../../memory-learning/forgotten-history.js';
import { createPersonalMemoryTool } from '../personal-memory-tool.js';
import { createKnowledgeReadTool } from '../knowledge-memory-tool.js';
import { createUserContextReadTool } from '../user-context-tool.js';

describe('explicit personal memory', () => {
  let directory: string;
  let text: string;
  let config: ReturnType<typeof ConfigSchema.parse>;
  let projectId: string | undefined;
  const conversationId = personalConversationId('local-owner');
  const agentId = personalAgentId('local-owner');
  const context = () => ({ conversationId, agentId, workspaceId: directory, projectId });
  const tool = () => createPersonalMemoryTool({ getConversationId: () => conversationId, getCurrentUserText: () => text,
    getConfig: () => config, agentId, workspaceId: directory, getProjectId: () => projectId });
  const say = (value: string) => {
    text = value;
    appendTranscriptEntry(conversationId, { role: 'user', content: value, timestamp: Date.now() });
  };
  const execute = async (input: Record<string, unknown>, callId = 'call') =>
    (await tool().execute(callId, { userEvidence: text, ...input })).details as Record<string, any>;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-chat-memory-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'test.db') });
    const catalog = new AgentCatalogRepository(); catalog.ensureInitialized(); catalog.create({ id: agentId }, { ready: true });
    createConversation({ agentId, sourceChannel: 'webchat', customData: { personalAgent: true } }, '', conversationId);
    config = ConfigSchema.parse({}); projectId = undefined; text = '';
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); });

  it('persists an explicit preference and a value-free receipt atomically across restart', async () => {
    say('记住我喜欢简洁回答');
    const input = { command: 'remember', target: 'user', content: '我喜欢简洁回答', predicate: 'preference.detail' };
    const receipt = await execute(input);
    expect(receipt).toMatchObject({ status: 'saved', usable: true, scope: { type: 'global' }, effectiveFrom: 'next_turn' });
    expect(buildExecutionContext({ ...context(), query: '简洁回答' }).assertions.some(item => item.assertion.id === receipt.id)).toBe(true);
    closeXopcDatabase(); openXopcDatabase({ path: join(directory, 'test.db') });
    expect(getUserAssertion(receipt.id)?.statement).toBe('我喜欢简洁回答');
    expect(await execute(input, 'different-tool-call')).toMatchObject({ receiptId: receipt.receiptId, id: receipt.id });
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM user_assertions').get()!.n).toBe(1);
    expect(getSqliteDatabase().prepare('SELECT result_json FROM capability_operations').get()!.result_json).not.toContain('简洁回答');
  });

  it('corrects using a read revision, rejects stale edits, and protects the corrected owner value', async () => {
    say('记住我喜欢简洁回答');
    const first = await execute({ command: 'remember', target: 'user', content: '简洁回答', predicate: 'preference.detail' });
    const reader = createUserContextReadTool({ ...context(), getSessionId: () => conversationId, canRead: () => true });
    const read = await reader.execute('read', { command: 'get', id: first.id });
    expect(read.details).toMatchObject({ version: first.version });
    say('纠正，我喜欢详细回答');
    const corrected = await execute({ command: 'correct', target: 'user', id: first.id, version: first.version, content: '详细回答' });
    expect(corrected).toMatchObject({ status: 'saved', usable: true });
    expect(getUserAssertion(first.id)?.status).toBe('archived');
    const current = getUserAssertion(corrected.id)!;
    const slot = getAssertionSlot(current.slotId)!;
    reconcileAssertion({ ...current, ...slot, subject: slot.subject, predicate: slot.predicate, cardinality: slot.cardinality,
      authority: 'system_inferred', value: '简洁回答', normalizedValue: '简洁回答', statement: '简洁回答', createdBy: 'runtime', observedAt: Date.now() });
    expect(getUserAssertion(corrected.id)?.statement).toBe('详细回答');
    expect((await execute({ command: 'correct', target: 'user', id: first.id, version: first.version, content: '旧版本' })).status).toBe('failed');
  });

  it.each(['global', 'agent', 'workspace', 'project', 'session'] as const)('resolves %s from trusted conversation context', async scope => {
    projectId = 'project-real'; say('记住项目使用 SQLite');
    const receipt = await execute({ command: 'remember', target: 'knowledge', scope, content: '使用 SQLite' });
    const ids = { global: undefined, agent: agentId, workspace: directory, project: projectId, session: conversationId };
    expect(receipt).toMatchObject({ status: 'saved', scope: { type: scope, ...(ids[scope] ? { id: ids[scope] } : {}) } });
  });

  it('fails a missing project without silently widening the scope', async () => {
    say('只在本项目记住使用 SQLite');
    expect(await execute({ command: 'remember', target: 'knowledge', scope: 'project', content: '使用 SQLite' })).toMatchObject({ status: 'failed', error: 'missing_project_scope' });
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM knowledge_items').get()!.n).toBe(0);
  });

  it('moves knowledge, suppresses old scope replay, and prevents stale revision writes', async () => {
    say('记住使用 pnpm');
    const first = await execute({ command: 'remember', target: 'knowledge', scope: 'global', content: '使用 pnpm' });
    const original = getKnowledgeItem(first.id)!;
    const reader = createKnowledgeReadTool({ ...context(), getSessionId: () => conversationId, canRead: () => true, canWrite: () => true,
      getWritePolicy: () => 'allow', getReadPolicy: () => ({ scopes: config.userContext.knowledgeMemory.readScopes, contentSources: config.userContext.knowledgeMemory.contentSources }) });
    expect((await reader.execute('read', { command: 'get', id: first.id })).details).toMatchObject({ version: first.version });
    say('只用于当前助手，修改范围');
    const moved = await execute({ command: 'scope', target: 'knowledge', id: first.id, version: first.version, scope: 'agent' });
    expect(moved).toMatchObject({ status: 'saved', scope: { type: 'agent', id: agentId } });
    expect(writeKnowledgeItem({ ...original, originClass: 'agent', replaceExisting: true })).toMatchObject({ suppressed: true });
    say('改成使用 npm');
    expect(await execute({ command: 'correct', target: 'knowledge', id: first.id, version: first.version, content: '使用 npm' })).toMatchObject({ status: 'failed', error: 'memory_version_conflict_read_again' });
    const corrected = await execute({ command: 'correct', target: 'knowledge', id: first.id, version: moved.version, content: '使用 npm' });
    expect(corrected.status).toBe('saved');
    expect(getKnowledgeItem(first.id)?.content).toBe('使用 npm');
  });

  it.each(['user', 'knowledge'] as const)('forgets %s durably without leaving content in receipts', async target => {
    say('记住喜欢中文回答');
    const first = await execute({ command: 'remember', target, content: '喜欢中文回答', predicate: 'preference.language' });
    const original = target === 'user' ? getUserAssertion(first.id)! : getKnowledgeItem(first.id)!;
    say('忘掉这条记忆');
    const input = { command: 'forget', target, id: first.id, version: first.version };
    const forgotten = await execute(input);
    expect(forgotten).toMatchObject({ status: 'forgotten', available: false, usable: false, originalSourcesRetained: true });
    expect(await execute(input, 'retry')).toMatchObject({ receiptId: forgotten.receiptId, status: 'forgotten' });
    expect(forgottenHistoryEntries(context()).has(`${conversationId}:*`)).toBe(true);
    if (target === 'knowledge') expect(writeKnowledgeItem(original as NonNullable<ReturnType<typeof getKnowledgeItem>>)).toMatchObject({ suppressed: true });
    else expect(getUserAssertion(first.id)).toBeUndefined();
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM transcript_entries WHERE role = ?').get('user')!.n).toBe(2);
    expect(getSqliteDatabase().prepare('SELECT result_json FROM capability_operations WHERE operation_id = ?').get(forgotten.receiptId)!.result_json).not.toContain('喜欢中文回答');
  });

  it.each(['不要记住我喜欢中文', '下面是引文：\n> 记住我喜欢中文', '“记住我喜欢中文”这句话是什么含义？'])('rejects ungrounded or negated requests: %s', async message => {
    say(message);
    expect((await execute({ command: 'remember', target: 'user', content: '喜欢中文', predicate: 'preference.language' })).status).toBe('failed');
  });

  it('honors temporary mode, write denial, sensitive review and source matching', async () => {
    say('记住健康状况良好');
    const input = { command: 'remember', target: 'user', content: '健康状况良好', predicate: 'health.status' };
    setSessionConfig(conversationId, { userContextMode: 'temporary' }, directory);
    expect((await execute(input)).error).toBe('memory_access_denied');
    setSessionConfig(conversationId, { userContextMode: 'enabled' }, directory);
    config.userContext.userModel.writePolicy = 'deny';
    expect((await execute(input)).error).toBe('memory_write_denied');
    config.userContext.userModel.writePolicy = 'allow';
    const receipt = await execute(input);
    expect(receipt).toMatchObject({ status: 'pending', usable: false });
    text = '记住另一条没有持久化的输入';
    expect((await execute(input)).error).toBe('explicit_current_user_request_required');
  });

  it('runs the actual Personal factory tool using the persisted owner input', async () => {
    say('记住喜欢中文回答');
    const message = { role: 'user' as const, content: text, timestamp: Date.now() };
    setPendingTranscriptUserMessage(conversationId, message);
    try {
      const factory = new AgentToolsFactory({ workspace: directory, bus: {} as never, getConfig: () => config,
        getCurrentContext: () => ({ conversationId, channel: 'webchat', chatId: 'owner' }) });
      const tool = factory.createCoreTools({ conversationId }).find(tool => tool.name === 'personal_memory');
      expect(tool).toBeDefined();
      const result = await tool!.execute('factory-save', { command: 'remember', target: 'user', predicate: 'preference.language',
        content: '喜欢中文回答', scope: 'agent', userEvidence: text });
      expect(result.details).toMatchObject({ status: 'saved', usable: true, scope: { type: 'agent', id: agentId } });
    } finally { clearPendingTranscriptUserMessage(conversationId); }
  });

  it('rolls back memory, evidence and receipt together if the receipt cannot commit', async () => {
    say('记住喜欢中文回答');
    getSqliteDatabase().exec("CREATE TEMP TRIGGER reject_memory_receipt BEFORE INSERT ON capability_operations BEGIN SELECT RAISE(ABORT, 'receipt_failure'); END");
    const input = { command: 'remember', target: 'user', content: '喜欢中文回答', predicate: 'preference.language' };
    expect((await execute(input)).status).toBe('failed');
    for (const table of ['user_assertions', 'context_evidence', 'capability_operations']) {
      expect(getSqliteDatabase().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n).toBe(0);
    }
    getSqliteDatabase().exec('DROP TRIGGER reject_memory_receipt');
    expect((await execute(input)).status).toBe('saved');
  });

  it('refuses widening an explicitly local request and fails closed in read-only and group conversations', async () => {
    say('只在当前项目记住使用 pnpm'); projectId = 'atlas';
    const input = { command: 'remember', target: 'knowledge', content: '使用 pnpm' };
    expect((await execute({ ...input, scope: 'global' })).error).toBe('requested_scope_mismatch');
    expect(await execute(input)).toMatchObject({ status: 'saved', scope: { type: 'project', id: 'atlas' } });
    setSessionInteractionPolicy(conversationId, { mode: 'default', access: 'read-only' });
    expect((await execute(input)).error).toBe('memory_write_denied');
    setSessionInteractionPolicy(conversationId, { mode: 'default', access: 'configured' });
    patchSessionMetadata(conversationId, { routing: { source: 'webchat', peerKind: 'group', peerId: 'group', accountId: 'default', agentId } });
    expect((await execute(input)).error).toBe('memory_access_denied');
  });

  it('distinguishes all Slack queries from an explicit request to apply a rule across projects', async () => {
    projectId = 'atlas';
    const preference = { command: 'remember', target: 'user', predicate: 'preference.tool.slack_read', content: '查询 Slack 时用 slacrawl CLI' };
    say('请记住，所有查询 Slack 的消息统一使用 slacrawl CLI。');
    expect(await execute({ ...preference, target: 'knowledge' }))
      .toMatchObject({ status: 'failed', error: 'collaboration_instruction_requires_preference' });
    expect(await execute({ ...preference, scope: 'global' }))
      .toMatchObject({ status: 'failed', error: 'requested_scope_mismatch' });
    const local = await execute(preference);
    expect(local).toMatchObject({ status: 'saved', scope: { type: 'project', id: 'atlas' } });
    say('把这条记忆改为适用于所有 Slack 查询');
    expect(await execute({ command: 'scope', target: 'user', id: local.id, version: local.version, scope: 'global' }))
      .toMatchObject({ status: 'failed', error: 'explicit_global_scope_required' });
    say('请记住，在所有项目里，查询 Slack 消息统一使用 slacrawl CLI。');
    expect(await execute(preference)).toMatchObject({ status: 'saved', scope: { type: 'global' } });
  });

  it('keeps narrowed assertion scope through relearning and permits an explicit move back', async () => {
    say('记住喜欢中文回答');
    const first = await execute({ command: 'remember', target: 'user', predicate: 'preference.language', content: '喜欢中文回答' });
    const assertion = getUserAssertion(first.id)!;
    const slot = getAssertionSlot(assertion.slotId)!;
    const oldCandidate = { ...assertion, ...slot, authority: 'user_observed' as const, createdBy: 'runtime' as const };
    say('只用于当前助手，修改范围');
    const moved = await execute({ command: 'scope', target: 'user', id: first.id, version: first.version, scope: 'agent' });
    expect(moved.scope).toEqual({ type: 'agent', id: agentId });
    expect(reconcileAssertion(oldCandidate)).toMatchObject({ action: 'suppressed' });
    say('修改为全局范围');
    const global = await execute({ command: 'scope', target: 'user', id: first.id, version: moved.version, scope: 'global' });
    say('纠正，喜欢详细中文回答');
    expect(await execute({ command: 'correct', target: 'user', id: first.id, version: global.version, content: '喜欢详细中文回答' }))
      .toMatchObject({ status: 'saved', usable: true });
  });

  it('does not delete a global record when the request only concerns this project', async () => {
    say('记住使用 pnpm');
    const first = await execute({ command: 'remember', target: 'knowledge', scope: 'global', content: '使用 pnpm' });
    projectId = 'atlas'; say('只在当前项目忘掉这条记忆');
    expect(await execute({ command: 'forget', target: 'knowledge', id: first.id, version: first.version }))
      .toMatchObject({ status: 'failed', error: 'requested_scope_mismatch' });
    expect(getKnowledgeItem(first.id)).toBeDefined();
  });

  it('accepts the unchanged scope on a correction but refuses changing it implicitly', async () => {
    say('记住使用 pnpm');
    const first = await execute({ command: 'remember', target: 'knowledge', scope: 'global', content: '使用 pnpm' });
    say('纠正，使用 npm，仍然用于所有协作');
    expect(await execute({ command: 'correct', target: 'knowledge', id: first.id, version: first.version,
      scope: 'agent', content: '使用 npm' })).toMatchObject({ status: 'failed', error: 'use_scope_command_to_change_scope' });
    expect(await execute({ command: 'correct', target: 'knowledge', id: first.id, version: first.version,
      scope: 'global', content: '使用 npm' })).toMatchObject({ status: 'saved', scope: { type: 'global' } });
  });
});
