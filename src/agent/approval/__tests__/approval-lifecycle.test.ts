import { resolveSessionActionApprovalMode } from '../session-mode.js';
import { TaskConversationRepository } from '../../../tasks/task-conversation-repository.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BeforeToolCallContext } from '@earendil-works/pi-agent-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AgentManager } from '../../agent-manager.js';
import { markActionApprovalCore } from '../action-policy.js';
import { getActionDispatchGuard, requestPreparedActionApproval, runWithEmbeddedExecutionSession } from '../../embedded/execution-context.js';
import { ConfigSchema } from '../../../config/schema.js';
import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { MessageBus } from '../../../infra/bus/index.js';
import { createReadFileTool } from '../../tools/read.js';
import { createDataBatchTool } from '../../tools/dataBatch.js';
import {
  claimNextSessionInput, closeXopcDatabase, consumeClarificationResume, createClarificationWait,
  ensureSessionRecord, finishSessionInputRun, getActiveClarification, insertSessionInput,
  openXopcDatabase, resolveClarification,
} from '../../../storage/sqlite/index.js';
import { setSessionConfig, getSessionConfig, updateSessionActionApprovalMode } from '../../../storage/sqlite/config-repository.js';

let dir: string;
let manager: AgentManager;
const id = '3147eb7c-a983-4a4a-9ffa-d72ff950cce8';
const request = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xopc-action-lifecycle-'));
  openXopcDatabase({ path: join(dir, 'state.db') });
  seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: dir }] });
  ensureSessionRecord(id, dir, { agentId: 'main' });
  setSessionConfig(id, { actionApprovalMode: 'ask' }, dir);
  request.mockReset().mockImplementation(async (context, payload) => {
    const wait = createClarificationWait({ ...context, ...payload, kind: 'approval' });
    return { status: 'waiting', waitId: wait.id };
  });
  manager = new AgentManager({ workspace: dir, model: 'deepseek/deepseek-chat', config: ConfigSchema.parse({}),
    bus: new MessageBus(), getCurrentContext: () => null, gatewayClarify: { requestClarification: request } });
});
afterEach(() => { manager?.dispose(); closeXopcDatabase(); rmSync(dir, { recursive: true, force: true }); });
function begin() {
  insertSessionInput({ id: 'input', conversationId: id, clientMessageId: 'message', requestedDelivery: 'next', effectiveDelivery: 'next',
    status: 'queued', content: 'Run the action', origin: { type: 'system', source: 'internal' } });
  claimNextSessionInput(id, 'origin');
}
function context(name = 'exec_command', args: unknown = { cmd: 'echo hello' }, toolCallId = 'call'): BeforeToolCallContext {
  return { toolCall: { type: 'toolCall', name, id: toolCallId, arguments: args }, args,
    context: { tools: [] } } as unknown as BeforeToolCallContext;
}
async function approve() {
  const wait = getActiveClarification(id)!;
  finishSessionInputRun(id, 'origin', 'suspended');
  expect(resolveClarification({ id: wait.id, action: 'answer', decision: 'approve', expectedVersion: wait.version, idempotencyKey: 'answer' }).ok).toBe(true);
  const resume = claimNextSessionInput(id, 'successor')!;
  expect(consumeClarificationResume(resume)).toBe(true);
}
it('uses the actual AgentManager gate to suspend and permit one exact successor call, then asks again for a second call', async () => {
  begin();
  const first = manager.createAgentTurnPolicy(id);
  expect(await runWithEmbeddedExecutionSession(id, () => first.beforeToolCall(context()), 'origin')).toMatchObject({ block: true, terminate: true });
  expect(request).toHaveBeenCalledTimes(1);
  await approve();
  const resumed = manager.createAgentTurnPolicy(id);
  expect(await runWithEmbeddedExecutionSession(id, () => resumed.beforeToolCall(context()), 'successor')).toBeUndefined();
  expect(request).toHaveBeenCalledTimes(1);
  expect(await runWithEmbeddedExecutionSession(id, () => resumed.beforeToolCall(context('exec_command', { cmd: 'echo hello' }, 'second')), 'successor')).toMatchObject({ block: true });
  expect(request).toHaveBeenCalledTimes(2);
});
it('cannot reuse approved arguments after the operation changes', async () => {
  begin();
  await runWithEmbeddedExecutionSession(id, () => manager.createAgentTurnPolicy(id).beforeToolCall(context()), 'origin');
  await approve();
  expect(await runWithEmbeddedExecutionSession(id, () => manager.createAgentTurnPolicy(id).beforeToolCall(context('exec_command', { cmd: 'echo changed' })), 'successor')).toMatchObject({ block: true });
  expect(request).toHaveBeenCalledTimes(2);
});
it('creates a single persisted approval for a parallel tool batch', async () => {
  begin();
  const policy = manager.createAgentTurnPolicy(id);
  const outcomes = await runWithEmbeddedExecutionSession(id, () => Promise.all([
    policy.beforeToolCall(context()), policy.beforeToolCall(context('mcp__mail__send', { body: 'hello' }, 'other')),
  ]), 'origin');
  expect(outcomes.every(result => result?.block)).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});
it('preapproves a complete data batch once without reasking for its suboperations', async () => {
  begin();
  const batch = context('data_batch', { operations: [{ id: 'web', kind: 'web_search', query: 'test' }] });
  batch.context.tools = [markActionApprovalCore(createDataBatchTool(dir, () => new Set(['web_search'])))];
  await runWithEmbeddedExecutionSession(id, () => manager.createAgentTurnPolicy(id).beforeToolCall(batch), 'origin');
  await approve();
  expect(await runWithEmbeddedExecutionSession(id, () => manager.createAgentTurnPolicy(id).beforeToolCall(batch), 'successor')).toBeUndefined();
  expect(request).toHaveBeenCalledTimes(1);
});
it('allows real core reads, preserves legacy/full behavior, and atomically refuses a mode change while running', async () => {
  writeFileSync(join(dir, 'note.md'), 'hello');
  const read = context('read_file', { path: 'note.md' });
  read.context.tools = [markActionApprovalCore(createReadFileTool(dir))];
  expect(await manager.createAgentTurnPolicy(id).beforeToolCall(read)).toBeUndefined();
  const version = getSessionConfig(id)!.updatedAt!;
  expect(updateSessionActionApprovalMode(id, 'full', version, dir)).toBe(true);
  expect(updateSessionActionApprovalMode(id, 'ask', version, dir)).toBe(false);
  expect(await manager.createAgentTurnPolicy(id).beforeToolCall(context())).toBeUndefined();
  begin();
  expect(updateSessionActionApprovalMode(id, 'ask', getSessionConfig(id)!.updatedAt!, dir)).toBe(false);
  expect(getSessionConfig(id)?.actionApprovalMode).toBe('full');
});

it('uses the same durable confirmation for the resolved connector account and preserves its confirmation floor in full mode', async () => {
  setSessionConfig(id, { actionApprovalMode: 'full' }, dir);
  begin();
  const call = context('xopc_tool_execute', { toolRef: 'cli:mail:send', arguments: { to: 'alice@example.com' } });
  const prepared = { toolRef: 'cli:mail:send', arguments: { to: 'alice@example.com' }, binding: { accountId: 'work', connectionId: 'connection-1', descriptorDigest: 'v1' }, readOnly: false, confirmationRequired: true };
  await runWithEmbeddedExecutionSession(id, async () => {
    expect(await manager.createAgentTurnPolicy(id).beforeToolCall(call)).toBeUndefined();
    expect(await requestPreparedActionApproval('call', prepared)).toBe(false);
  }, 'origin');
  expect(request).toHaveBeenCalledTimes(1);
  expect(getActiveClarification(id)?.approval?.argumentsPreview).toMatchObject({ target: { accountId: 'work' } });
  await approve();
  await runWithEmbeddedExecutionSession(id, async () => {
    expect(await manager.createAgentTurnPolicy(id).beforeToolCall(call)).toBeUndefined();
    expect(await requestPreparedActionApproval('call', prepared)).toBe(true);
  }, 'successor');
  expect(request).toHaveBeenCalledTimes(1);
});

it('invalidates reviewed script contents immediately before command dispatch', async () => {
  writeFileSync(join(dir, 'script.mjs'), 'console.log(1);');
  begin();
  const call = context('exec_command', { cmd: 'node script.mjs' });
  await runWithEmbeddedExecutionSession(id, () => manager.createAgentTurnPolicy(id).beforeToolCall(call), 'origin');
  await approve();
  await runWithEmbeddedExecutionSession(id, async () => {
    expect(await manager.createAgentTurnPolicy(id).beforeToolCall(call)).toBeUndefined();
    writeFileSync(join(dir, 'script.mjs'), 'console.log(2);');
    expect(() => getActionDispatchGuard('call')!()).toThrow('changed before dispatch');
  }, 'successor');
});

it('clamps a persistent Task worker to its originating conversation approval mode', () => {
  const worker = '37eaed15-845a-4f9a-8772-407c3a8bde10';
  ensureSessionRecord(worker, dir, { agentId: 'main' });
  setSessionConfig(worker, { actionApprovalMode: 'full' }, dir);
  const task = new TaskRepository().create({ title: 'Fixture', objective: 'Keep parent approval' });
  getSqliteDatabase().prepare('INSERT INTO task_origin_links(task_id, conversation_id, created_at) VALUES (?, ?, ?)').run(task.id, id, Date.now());
  new TaskConversationRepository().activateExecutionSession({ taskId: task.id, conversationId: worker, agentId: 'main' });
  expect(resolveSessionActionApprovalMode(worker)).toBe('ask');
});

it('distinguishes pending approval, denial, and unavailable confirmation without exposing retry instructions', async () => {
  begin();
  const pending = await runWithEmbeddedExecutionSession(id, () => manager.createAgentTurnPolicy(id).beforeToolCall(context()), 'origin');
  expect(pending).toMatchObject({ block: true, terminate: true, reason: '正在等待你确认，操作尚未执行。' });
  const wait = getActiveClarification(id)!;
  finishSessionInputRun(id, 'origin', 'suspended');
  expect(resolveClarification({ id: wait.id, action: 'answer', decision: 'deny', expectedVersion: wait.version, idempotencyKey: 'deny' }).ok).toBe(true);
  const resume = claimNextSessionInput(id, 'successor')!;
  expect(consumeClarificationResume(resume)).toBe(true);
  const denied = await runWithEmbeddedExecutionSession(id, () => manager.createAgentTurnPolicy(id).beforeToolCall(context()), 'successor');
  expect(denied).toMatchObject({ block: true, terminate: true, reason: '这次操作未获批准，未执行。' });
  expect(request).toHaveBeenCalledOnce();
  request.mockRejectedValueOnce(new Error('transport failed'));
  const unavailable = await runWithEmbeddedExecutionSession(id, () => manager.createAgentTurnPolicy(id).beforeToolCall(context()), 'successor');
  expect(unavailable).toMatchObject({ block: true, terminate: true, reason: '暂时无法发起操作确认，操作未执行。请稍后重试。' });
});

it('reports changed authorization separately and never binds an execution guard', async () => {
  begin();
  request.mockImplementationOnce(async () => {
    setSessionConfig(id, { actionApprovalMode: 'full' }, dir);
    return { status: 'answered', answer: 'approve' };
  });
  await runWithEmbeddedExecutionSession(id, async () => {
    const result = await manager.createAgentTurnPolicy(id).beforeToolCall(context());
    expect(result).toMatchObject({ block: true, terminate: true, reason: '操作内容或授权已变化，本次未执行。请重新确认后继续。' });
    expect(getActionDispatchGuard('call')).toBeUndefined();
  }, 'origin');
});
