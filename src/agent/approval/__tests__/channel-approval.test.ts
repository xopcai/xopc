import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import { MessageBus } from '../../../infra/bus/index.js';
import { registerChannelExecApprovalHandler } from '../../../channels/exec-approval-runtime.js';
import { GatewayAgentRunner } from '../../../gateway/service/agent-runner.js';
import { closeXopcDatabase, createClarificationWait, ensureSessionRecord, openXopcDatabase } from '../../../storage/sqlite/index.js';

let dir: string;
let runner: GatewayAgentRunner;
let unregister: () => void;
let recipients: string[];
const id = '2eb48a0e-6fed-4d1f-a86c-82084de6a426';
let waitId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xopc-channel-approval-'));
  openXopcDatabase({ path: join(dir, 'state.db') });
  ensureSessionRecord(id, dir, { agentId: 'main', sourceChannel: 'telegram', routing: {
    agentId: 'main', source: 'telegram', accountId: 'work', peerKind: 'direct', peerId: '123',
  } });
  waitId = createClarificationWait({ conversationId: id, runId: 'run', toolCallId: 'call', kind: 'approval', question: 'Run?', approval: { operation: 'exec_command' } }).id;
  recipients = ['123'];
  unregister = registerChannelExecApprovalHandler('telegram', { isEnabled: () => true, approvalRecipients: () => recipients, requestApproval: async () => { throw new Error('Legacy approval must not be called'); } });
  runner = new GatewayAgentRunner({ bus: new MessageBus(), sessionIndex: {} as never,
    getAgentService: () => { throw new Error('No inference in this test'); }, getChannelManager: () => ({} as never), getConfig: () => ConfigSchema.parse({}),
    emit: vi.fn(), publishRealtime: vi.fn(), completeRealtimeTopic: vi.fn(), resolveTurnContext: async () => null });
  vi.spyOn(runner, 'resolveClarificationResponse').mockReturnValue({ ok: true, queued: false } as never);
});
afterEach(() => { runner?.disposeClarifications(); unregister?.(); closeXopcDatabase(); rmSync(dir, { recursive: true, force: true }); });
it('requires an actual sender and the originating account, and rechecks current approvers', () => {
  const identity = { channel: 'telegram', accountId: 'work', chatId: '123', senderId: '123' };
  expect(runner.answerClarificationDecision(waitId, 'approve', 'missing')).toBe(false);
  expect(runner.answerClarificationDecision(waitId, 'approve', 'wrong-account', { ...identity, accountId: 'other' })).toBe(false);
  expect(runner.answerClarificationDecision(waitId, 'approve', 'wrong-user', { ...identity, senderId: '999' })).toBe(false);
  expect(runner.answerClarificationDecision(waitId, 'approve', 'accepted', identity)).toBe(true);
  recipients = [];
  expect(runner.answerClarificationDecision(waitId, 'approve', 'revoked', identity)).toBe(false);
});
