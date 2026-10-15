import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { createClarifyTool } from '../../../../agent/tools/clarify-tool.js';
import {
  claimNextSessionInput, closeXopcDatabase, consumeClarificationApproval, consumeClarificationResume,
  createClarificationWait, ensureSessionRecord, finishSessionInputRun, getClarification,
  getClarificationSnapshot, insertSessionInput, openXopcDatabase, resolveClarification,
} from '../../../../storage/sqlite/index.js';
import { ChatStreamMapper } from '../../../chat-stream/mapper.js';
import { buckets } from '../../../rate-limit/index.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';

it('runs structured clarification lifecycles through a listening authenticated Gateway and real SQLite queue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xopc-clarify-http-'));
  const dbPath = join(dir, 'xopc.db');
  openXopcDatabase({ path: dbPath });
  buckets.resetAllForTests();
  const auth = { mode: 'token' as const, token: 'clarification-fixture-token' };
  // The host/model execution is controlled; routing, authorization, validation and storage are real.
  const service = {
    currentConfig: ConfigSchema.parse({ gateway: { auth } }),
    getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    isGatewayReady: () => true, getHealth: () => ({ status: 'healthy' }),
    getClarificationState: getClarificationSnapshot, resolveClarificationResponse: resolveClarification,
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  let base = '';
  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  function begin(conversationId: string) {
    ensureSessionRecord(conversationId, dir, { agentId: 'main' });
    insertSessionInput({ id: conversationId + '-input', conversationId, clientMessageId: conversationId + '-client',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'Prepare deployment', origin: { type: 'system', source: 'internal' } });
    claimNextSessionInput(conversationId, conversationId + '-run');
  }
  const conversationId = '5f8923f9-52c1-47a6-8174-bfe092661681';
  try {
    if (!gateway.listening) await once(gateway, 'listening');
    const address = gateway.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    base = `http://127.0.0.1:${address.port}`;
    begin(conversationId);
    const tool = createClarifyTool({ resolveAskUser: toolCallId => async payload => {
      const wait = createClarificationWait({ conversationId, runId: conversationId + '-run', toolCallId, kind: 'input', ...payload });
      return { status: 'waiting', waitId: wait.id };
    } });
    const result = await tool.execute('choose-environment', { question: 'Where?', interactionMode: 'compose',
      choiceDetails: [{ id: 'stage', label: 'Stage', description: 'For testing' }, { id: 'prod', label: 'Prod' }], recommendedChoiceId: 'stage' });
    expect(result.details).toMatchObject({ status: 'waiting' });
    finishSessionInputRun(conversationId, conversationId + '-run', 'suspended');
    const path = `/api/sessions/${conversationId}/clarification`;
    expect((await fetch(base + path)).status).toBe(401);
    const snapshot = await request(path);
    expect(snapshot.status).toBe(200);
    const wait = snapshot.data.payload.clarification;
    expect(wait).toMatchObject({ interactionMode: 'compose', choiceDetails: [{ id: 'stage', label: 'Stage', description: 'For testing' }, { id: 'prod', label: 'Prod' }], recommendedChoiceId: 'stage' });
    // Production stream mapping must retain the new fields as well as legacy labels.
    const mapper = new ChatStreamMapper({ runId: 'run', conversationId, channel: 'webchat' });
    const event = mapper.map({ type: 'clarify_request', ...wait, requestId: wait.id })[0];
    expect(event.payload).toMatchObject({ interactionMode: 'compose', choiceDetails: wait.choiceDetails });
    closeXopcDatabase(); openXopcDatabase({ path: dbPath });
    expect((await request(path)).data.payload.clarification.id).toBe(wait.id);
    const responsePath = `/api/clarifications/${wait.id}/responses`;
    const command = { action: 'answer', expectedVersion: wait.version, idempotencyKey: 'response-1', response: { choiceId: 'prod', text: 'After 22:00\nVerify first' } };
    expect((await fetch(base + responsePath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) })).status).toBe(401);
    expect((await request(responsePath, 'POST', { ...command, response: { choiceId: 'unknown' } })).status).toBe(400);
    expect((await request(responsePath, 'POST', { ...command, answer: 'Stage' })).status).toBe(400);
    const submitted = await request(responsePath, 'POST', command);
    expect(submitted.status).toBe(202);
    expect(submitted.data.payload.clarification).toMatchObject({ status: 'queued', response: command.response });
    expect((await request(responsePath, 'POST', command)).data.payload.idempotent).toBe(true);
    expect((await request(responsePath, 'POST', { ...command, response: { choiceId: 'stage' } })).status).toBe(409);
    expect((await request(responsePath, 'POST', { ...command, idempotencyKey: 'another-device' })).status).toBe(409);
    const resume = claimNextSessionInput(conversationId, 'resume-run')!;
    expect(resume.kind).toBe('clarification_resume');
    expect(resume.content).toContain('Choice: Prod\nAdditional information: After 22:00\nVerify first');
    expect(consumeClarificationResume(resume)).toBe(true);
    expect(getClarification(wait.id)?.status).toBe('resolved');
    expect((await request(path)).data.payload.clarification).toBeNull();
    finishSessionInputRun(conversationId, 'resume-run', 'completed');

    const customId = '5f8923f9-52c1-47a6-8174-bfe092661682'; begin(customId);
    const custom = createClarificationWait({ conversationId: customId, runId: customId + '-run', toolCallId: 'custom-tool', kind: 'input', question: 'Language?', choiceDetails: [{ id: 'EN', label: 'EN' }, { id: 'ZH', label: 'ZH' }] });
    finishSessionInputRun(customId, customId + '-run', 'suspended');
    expect((await request(`/api/clarifications/${custom.id}/responses`, 'POST', { action: 'answer', response: { text: 'Custom answer' }, expectedVersion: custom.version, idempotencyKey: 'custom-response' })).status).toBe(202);
    expect(claimNextSessionInput(customId, 'custom-resume')!.content).toContain('Custom answer');

    const approvalId = '5f8923f9-52c1-47a6-8174-bfe092661683'; begin(approvalId);
    const approval = createClarificationWait({ conversationId: approvalId, runId: approvalId + '-run', toolCallId: 'approve-tool', kind: 'approval', question: 'Run once?', approvalKey: 'exact-operation', approval: { operation: 'deploy' } });
    finishSessionInputRun(approvalId, approvalId + '-run', 'suspended');
    const approvalPath = `/api/clarifications/${approval.id}/responses`;
    const identity = { expectedVersion: approval.version, idempotencyKey: 'approve-response' };
    for (const invalid of [{ action: 'agent_decide' }, { action: 'answer', answer: 'yes' }, { action: 'answer', response: { text: 'Allow once' } }]) {
      expect((await request(approvalPath, 'POST', { ...identity, ...invalid })).status).toBe(400);
    }
    expect((await request(approvalPath, 'POST', { ...identity, action: 'answer', decision: 'approve' })).status).toBe(202);
    const approvalResume = claimNextSessionInput(approvalId, 'approval-resume')!;
    expect(consumeClarificationApproval(approvalId, 'different-operation')).toBeUndefined();
    expect(consumeClarificationApproval(approvalId, 'exact-operation')).toBe('approved');
    expect(consumeClarificationApproval(approvalId, 'exact-operation')).toBeUndefined();
    expect(consumeClarificationResume(approvalResume)).toBe(true);
  } finally {
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    closeXopcDatabase(); buckets.resetAllForTests(); await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
