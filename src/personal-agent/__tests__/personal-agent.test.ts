import { generateKeyPairSync } from 'node:crypto';
import { signedDeviceHeaders } from '../../gateway/security/__tests__/signed-device-headers.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { TASK_RESULT_DELIVERY_TYPE, type TurnOutcome, type TurnOutcomeDeliverable } from '@xopcai/gateway-contract';
import { describe, expect, it, vi } from 'vitest';
import type { Api, Model } from '@earendil-works/pi-ai';
import { SessionHydrator } from '../../agent/session/session-hydrator.js';

import { ConfigSchema } from '../../config/schema.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { AgentCatalogService } from '../../agent-catalog/service.js';
import { AgentToolsFactory } from '../../agent/tools/factory.js';
import { createPersonalTaskTool } from '../../agent/tools/personal-task-tool.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { taskOutcomeReferencesMediaUri } from '../../media/session-references.js';
import { listDeliverables } from '../../tasks/task-deliverables.js';
import { AutomationService } from '../../automations/service/automation-service.js';
import { applyUserProfilePatch } from '../../user-model/profile.js';
import { SessionConfigService } from '../../agent/session/session-config-service.js';
import { SessionConfigStore } from '../../session/config-store.js';
import type { MessageBus } from '../../infra/bus/index.js';
import * as agentsAdmin from '../../gateway/agents-admin.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import type { GatewayService } from '../../gateway/service.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { deleteSessionConfig, getSessionConfig, setSessionConfig } from '../../storage/sqlite/config-repository.js';
import { getSessionMetadata, listSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { createDevice, issueDeviceTokenPair } from '../../storage/sqlite/device-access-repository.js';
import { DEFAULT_MOBILE_SCOPES } from '../../gateway/security/gateway-scopes.js';
import { getPersonalAgent, isPersonalConversation, personalAgentId, personalConversationId } from '../repository.js';
import { createOrResumePersonalAgent, ensurePersonalConversationVisibility, personalInstructions, updatePersonalProfileRecord } from '../service.js';

import { PERSONAL_RELIABILITY_RULES } from '../communication.js';

describe('personal Agent identity', () => {

  it('keeps one identity and conversation and serves it through the authenticated Gateway', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-personal-agent-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    const token = 'personal-agent-test-token';
    const automationService = new AutomationService();
    const app = createHonoApp({ service: {
      currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
      getResolvedAuth: () => ({ mode: 'token', token }),
      getAuthToken: () => token,
      isGatewayReady: () => true,
      getExtensionLoader: () => null,
      refreshAgentCatalog: vi.fn(),
      agentService: { evictSessionAgent: vi.fn() },
      automationServiceInstance: automationService,
    } as unknown as GatewayService });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      const agentId = personalAgentId('local-owner');
      const conversationId = personalConversationId('local-owner');
      const repository = new AgentCatalogRepository();
      repository.ensureInitialized();
      repository.create({ id: agentId, profile: { name: 'Personal AI', emoji: '✦' }, runtime: { thinkingLevel: 'off' } }, { ready: true });
      createConversation({ agentId, customData: { personalAgent: true } }, '', conversationId);
      appendTranscriptEntry(conversationId, { role: 'user', content: 'Hi' });
      expect(listSessionMetadata({ limit: 10 }).items.map((item) => item.key)).toContain(conversationId);
      ensurePersonalConversationVisibility('local-owner');
      expect(getSessionMetadata(conversationId)?.hiddenFromSessionList).toBe(true);
      expect(getSessionMetadata(conversationId)?.customData?.keepHiddenFromSessionList).toBe(true);
      expect(listSessionMetadata({ limit: 10 }).items.map((item) => item.key)).not.toContain(conversationId);
      expect(getPersonalAgent('local-owner')?.state).toBe('provisioning');
      if (!server.listening) await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing Gateway address');
      const url = `http://127.0.0.1:${address.port}/api/personal-agent`;
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const onboardingUrl = `${url}/onboarding`;
      expect((await fetch(onboardingUrl)).status).toBe(401);
      const savedDraft = await fetch(onboardingUrl, { method: 'PUT', headers,
        body: JSON.stringify({ step: 'identity', draft: { displayName: '阿沐' } }) });
      expect(savedDraft.status).toBe(200);
      expect(await savedDraft.json()).toMatchObject({ ok: true, payload: { step: 'identity', draft: { displayName: '阿沐' } } });
      const loadedDraft = await fetch(onboardingUrl, { headers });
      expect(loadedDraft.status).toBe(200);
      expect(await loadedDraft.json()).toMatchObject({ ok: true, payload: { draft: { displayName: '阿沐' } } });
      expect((await fetch(`${onboardingUrl}/welcome`, { method: 'POST', headers })).status).toBe(409);
      setSessionConfig(conversationId, { thinkingLevel: 'off', fixedModel: true, modelOverride: 'test/fast' }, dir);
      const first = getPersonalAgent('local-owner');
      if (!first) throw new Error('Missing Personal AI');
      const second = getPersonalAgent('local-owner');
      if (!second) throw new Error('Missing Personal AI');
      expect(second.conversationId).toBe(first.conversationId);
      expect(second.agentId).toBe(first.agentId);
      applyUserProfilePatch({ callName: 'Joyce' });
      expect(getPersonalAgent('local-owner')?.userCallName).toBe('Joyce');
      applyUserProfilePatch({ callName: '' });
      expect(getPersonalAgent('local-owner')?.userCallName).toBeNull();
      expect(isPersonalConversation(first.conversationId)).toBe(true);
      const tools = new AgentToolsFactory({ workspace: dir, bus: {} as MessageBus,
        getCurrentContext: () => null, dispatchTaskRuns: () => {} })
        .createCoreTools({ agentId: first.agentId, conversationId: first.conversationId,
          toolAllowlist: ['xopc_use', 'exec_command', 'personal_task', 'personal_preference'] })
        .map(tool => tool.name);
      expect(tools).toContain('personal_task');
      expect(tools).not.toContain('personal_preference');
      expect(tools).not.toContain('xopc_use');
      expect(tools).not.toContain('exec_command');
      const ordinary = createConversation({ agentId: first.agentId }, dir).key;
      const ordinaryTools = new AgentToolsFactory({ workspace: dir, bus: {} as MessageBus,
        getCurrentContext: () => null, dispatchTaskRuns: () => {} })
        .createCoreTools({ agentId: first.agentId, conversationId: ordinary,
          toolAllowlist: ['xopc_use', 'exec_command', 'personal_task', 'personal_preference'] }).map(tool => tool.name);
      expect(ordinaryTools).toContain('xopc_use');
      expect(ordinaryTools).toContain('exec_command');
      repository.create({ id: 'researcher', profile: { name: 'Research Assistant' },
        toolAllowlist: ['web_search'], tools: { web_fetch: { mode: 'deny' } } }, { ready: true });
      repository.create({ id: 'coder', profile: { name: 'Coding Expert' }, toolAllowlist: ['exec_command'] }, { ready: true });
      const agentsResult = await createPersonalTaskTool({
        getCurrentConversationId: () => conversationId,
        getCurrentAgentId: () => agentId,
      }).execute('list-agents', { command: 'match' }, undefined, undefined as never);
      const candidates = JSON.parse(agentsResult.content[0]!.text as string).candidates as Array<{ id: string; availableTools: string[] }>;
      expect(candidates.find(candidate => candidate.id === 'researcher')?.availableTools).toContain('web_search');
      expect(candidates.find(candidate => candidate.id === 'researcher')?.availableTools).not.toContain('web_fetch');
      const filtered = await createPersonalTaskTool({
        getCurrentConversationId: () => conversationId,
        getCurrentAgentId: () => agentId,
      }).execute('find-code-agent', { command: 'match', requiredTools: ['exec_command'] }, undefined, undefined as never);
      const codeCandidates = JSON.parse(filtered.content[0]!.text as string).candidates as Array<{ id: string }>;
      expect(codeCandidates.map(candidate => candidate.id)).toContain('coder');
      expect(codeCandidates.find(candidate => candidate.id === 'researcher')).toMatchObject({ eligibility: 'blocked' });
      expect(await updatePersonalProfileRecord('local-owner', 999, '阿沐', 'spark')).toBeNull();
      const updated = await updatePersonalProfileRecord('local-owner', first.revision, '阿沐',
        'cloud', undefined, { openingGreetingEnabled: false, defaultMode: 'natural', naturalModel: 'boson/higgs-realtime', higgsVoice: 'chloe' });
      expect(updated?.revision).toBe(first.revision + 1);
      expect(updated?.voiceCallPreferences.openingGreetingEnabled).toBe(false);
      const preserved = await updatePersonalProfileRecord('local-owner', updated!.revision, '阿沐',
        'cloud');
      expect(preserved?.voiceCallPreferences.openingGreetingEnabled).toBe(false);
      expect(getPersonalAgent('local-owner')?.displayName).toBe('阿沐');
      expect(repository.get(agentId)?.profile?.instructions).toBe(personalInstructions());
      expect(getSqliteDatabase().prepare("SELECT name FROM sqlite_master WHERE name = 'personal_agents'").get()).toBeUndefined();

      const beforeProfile = getPersonalAgent('local-owner')!;
      const profileResponse = await fetch(`${url}/profile`, { method: 'PATCH', headers,
        body: JSON.stringify({ revision: beforeProfile.revision, displayName: beforeProfile.displayName,
          appearance: beforeProfile.appearance,
          voiceCallPreferences: { openingGreetingEnabled: true } }) });
      expect(profileResponse.status).toBe(200);
      const obsoleteResponse = await fetch(`${url}/profile`, { method: 'PATCH', headers,
        body: JSON.stringify({ revision: getPersonalAgent('local-owner')!.revision, displayName: 'Ada',
          appearance: 'loopi', preferences: { warmth: 'gentle' } }) });
      expect(obsoleteResponse.status).toBe(400);

      expect(await profileResponse.json()).toMatchObject({ payload: { voiceCallPreferences: {
        openingGreetingEnabled: true, defaultMode: 'natural', naturalModel: 'boson/higgs-realtime', higgsVoice: 'chloe',
      } } });
      const current = getPersonalAgent('local-owner')!;
      const inheritResponse = await fetch(`${url}/profile`, { method: 'PATCH', headers,
        body: JSON.stringify({ revision: current.revision, displayName: current.displayName, appearance: current.appearance,
          voiceCallPreferences: { naturalModel: null, higgsVoice: null } }) });
      expect(inheritResponse.status).toBe(200);
      expect((await inheritResponse.json()).payload.voiceCallPreferences).toEqual({ openingGreetingEnabled: true, defaultMode: 'natural' });
      expect((await fetch(url)).status).toBe(401);
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, payload: { displayName: '阿沐', conversationId: first.conversationId } });
      const tasks = new TaskRepository();
      const pending = tasks.create({ title: 'Older approval', objective: 'Review plan', now: 1 });
      const recent = tasks.create({ title: 'Recent delivery', objective: 'Deliver plan', now: 2 });
      tasks.setLifecycle({ taskId: recent.id, expectedVersion: recent.version, phase: 'closed', resolution: 'done', now: 3 });
      const unrelated = tasks.create({ title: 'Other work', objective: 'Other work' });
      const linkOrigin = getSqliteDatabase().prepare('INSERT INTO task_origin_links (task_id, conversation_id, created_at) VALUES (?, ?, ?)');
      linkOrigin.run(pending.id, conversationId, 1);
      linkOrigin.run(recent.id, conversationId, 2);
      linkOrigin.run(unrelated.id, ordinary, 3);
      new TaskRunRepository().createWait({ taskId: pending.id, kind: 'approval', reason: 'Approve the plan', condition: {} });
      const activityUrl = `${url}/activity?view=work&limit=1`;
      expect((await fetch(activityUrl)).status).toBe(401);
      const activity = await fetch(activityUrl, { headers });
      expect(activity.status).toBe(200);
      expect(await activity.json()).toMatchObject({ payload: { current: [{ id: pending.id, attention: { kind: 'approval_required' } }],
        total: 1, items: [{ id: recent.id }] } });
      const report: TurnOutcomeDeliverable = { artifactId: 'report', title: 'Report.html', kind: 'site',
        location: 'artifact_store', availability: 'available', capabilities: ['preview'], uri: 'media://outbound/report.html' };
      const outcome = (turnId: string, deliverables: TurnOutcomeDeliverable[]): TurnOutcome => ({
        version: 1, outcomeId: `${turnId}:outcome`, runId: turnId, turnId, status: 'succeeded',
        evidence: [], createdAt: new Date().toISOString(), deliverables,
      });
      const appendOutcome = (scope: string, data: TurnOutcome) => appendTranscriptEntry(scope,
        { type: 'custom', customType: 'turn_outcome', data } as Parameters<typeof appendTranscriptEntry>[1]);
      appendOutcome(ordinary, outcome('other-turn', [{ ...report, artifactId: 'private', uri: 'media://outbound/private.html' }]));
      appendOutcome(conversationId, outcome('personal-turn', [
        report, { ...report, artifactId: 'summary', title: 'Summary.pdf', kind: 'pdf', uri: 'media://outbound/summary.pdf' },
        { ...report, artifactId: 'expired', uri: 'media://outbound/expired.html', expiresAt: '2000-01-01' },
      ]));
      appendTranscriptEntry(conversationId, { role: 'toolResult', turnId: 'note-turn', content: [], details: {
        delivery: { version: 2, operation: 'created', primary: { kind: 'note', id: 'note-1', title: 'Published note' } },
      } } as Parameters<typeof appendTranscriptEntry>[1]);
      appendTranscriptEntry(conversationId, { role: 'custom', customType: TASK_RESULT_DELIVERY_TYPE, content: '',
        details: { version: 1, deliveryId: 'delivery-1', taskId: recent.id, taskTitle: recent.title,
          taskRunId: 'worker-run', conversationId, originTranscriptId: 'personal-transcript',
          assignmentEpoch: 1, createdAt: Date.now(), outcome: outcome('worker-run', [report]) },
      } as Parameters<typeof appendTranscriptEntry>[1]);
      const execution = createConversation({ agentId: first.agentId }, dir).key;
      const run = new TaskRunRepository().create({ taskId: recent.id, executorKind: 'agent',
        executorRef: { agentId: first.agentId }, trigger: {}, correlationId: 'report-run',
        idempotencyKey: 'report-run', contractVersion: recent.latestContractVersion, conversationId: execution });
      const undelivered = { ...report, artifactId: 'worker-only', title: 'Worker only.html', uri: 'media://outbound/worker-only.html' };
      getSqliteDatabase().prepare(`INSERT INTO task_run_outcomes (task_run_id, outcome_id, assignment_epoch, outcome_json, created_at)
        VALUES (?, ?, ?, ?, ?)`).run(run.id, 'worker-outcome', 1, JSON.stringify(outcome(run.id, [undelivered])), 10);
      appendTranscriptEntry(execution, { role: 'toolResult', turnId: 'worker-note-turn', content: [], details: {
        delivery: { version: 2, operation: 'created', primary: { kind: 'note', id: 'worker-note', title: 'Worker note' } },
      } } as Parameters<typeof appendTranscriptEntry>[1]);
      expect(taskOutcomeReferencesMediaUri(recent.id, undelivered.uri)).toBe(true);
      expect(taskOutcomeReferencesMediaUri(unrelated.id, undelivered.uri)).toBe(false);
      expect(listDeliverables({ taskId: recent.id }, 100).items).toMatchObject([
        { reference: { id: 'worker-note' } }, { artifact: { artifactId: 'worker-only' } },
      ]);
      const deliverablesUrl = `${url}/activity?view=deliverables&limit=2`;
      expect((await fetch(deliverablesUrl)).status).toBe(401);
      const deliverables = await fetch(deliverablesUrl, { headers });
      expect(deliverables.status).toBe(200);
      expect((await deliverables.json()).payload).toMatchObject({ nextOffset: 2, items: [
        { reference: { id: 'worker-note' }, task: { id: recent.id, conversationId: execution } },
        { artifact: { artifactId: 'report' }, turnId: 'task-result:delivery-1', task: { id: recent.id } },
      ] });
      const olderDeliverables = await fetch(`${deliverablesUrl}&offset=2`, { headers });
      expect((await olderDeliverables.json()).payload).toMatchObject({ nextOffset: 4, items: [
        { reference: { id: 'note-1', kind: 'note' }, turnId: 'note-turn' },
        { artifact: { artifactId: 'summary' }, turnId: 'personal-turn' },
      ] });
      const oldestDeliverables = await fetch(`${deliverablesUrl}&offset=4`, { headers });
      expect((await oldestDeliverables.json()).payload).toMatchObject({ nextOffset: null, items: [
        { artifact: { artifactId: 'worker-only' }, task: { id: recent.id, conversationId: execution } },
      ] });
      await automationService.initialize();
      const scheduleUrl = `${url}/schedules`;
      expect((await fetch(scheduleUrl)).status).toBe(401);
      const scheduleInput = { name: 'Scheduled AI digest', instruction: 'Prepare a short AI digest.', locale: 'en',
        schedule: { kind: 'cron', expr: '0 9 * * 1-5', tz: 'Asia/Shanghai' } };
      const createdSchedule = await fetch(scheduleUrl, { method: 'POST', headers, body: JSON.stringify(scheduleInput) });
      expect(createdSchedule.status).toBe(201);
      const { payload: schedule } = await createdSchedule.json();
      expect(schedule).toMatchObject({ action: { kind: 'personal_task', conversationId, agentId }, state: { nextRunAtMs: expect.any(Number) } });
      const editScheduleUrl = `${scheduleUrl}/${schedule.id}`;
      const paused = await fetch(editScheduleUrl, { method: 'PATCH', headers, body: JSON.stringify({ enabled: false, expectedRevision: schedule.updatedAtMs }) });
      expect(paused.status).toBe(200);
      expect((await paused.json()).payload.enabled).toBe(false);
      expect((await fetch(editScheduleUrl, { method: 'PATCH', headers, body: JSON.stringify({ enabled: true, expectedRevision: schedule.updatedAtMs }) })).status).toBe(409);
      const runNow = await fetch(`${editScheduleUrl}/run`, { method: 'POST', headers });
      expect(runNow.status).toBe(202);
      const { payload: scheduledRun } = await runNow.json();
      await vi.waitFor(async () => expect((await automationService.getRun(scheduledRun.id))?.status).toBe('succeeded'));
      const task = tasks.getByIdempotencyKey(`personal-schedule:${scheduledRun.id}`)!;
      expect(task).toMatchObject({ title: scheduleInput.name, body: scheduleInput.instruction });
      expect(getSqliteDatabase().prepare('SELECT conversation_id, request_input_id FROM task_origin_links WHERE task_id = ?').get(task.id))
        .toEqual({ conversation_id: conversationId, request_input_id: null });
      expect(new TaskRunRepository().getActiveRoot(task.id)?.executorRef).toMatchObject({ agentId });
      const listedSchedules = await fetch(scheduleUrl, { headers });
      expect((await listedSchedules.json()).payload).toMatchObject([{ id: schedule.id, enabled: false }]);
      const timed = await fetch(scheduleUrl, { method: 'POST', headers, body: JSON.stringify({ ...scheduleInput,
        name: 'One-time Personal digest', schedule: { kind: 'once', at: new Date(Date.now() + 1000).toISOString() },
      }) });
      expect(timed.status).toBe(201);
      await vi.waitFor(() => {
        const tasksForSchedule = getSqliteDatabase().prepare(`SELECT t.task_id FROM tasks t
          JOIN task_origin_links origin ON origin.task_id = t.task_id WHERE origin.conversation_id = ? AND t.title = ?`)
          .all(conversationId, 'One-time Personal digest');
        expect(tasksForSchedule).toHaveLength(1);
      }, { timeout: 7000 });
      const phoneKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      createDevice({ id: 'personal-phone', displayName: 'Phone', platform: 'harmonyos',
        publicKeyJwk: phoneKeys.publicKey.export({ format: 'jwk' }), scopes: [...DEFAULT_MOBILE_SCOPES] });
      const phoneToken = issueDeviceTokenPair('personal-phone').accessToken;
      const deviceFetch = (target: string, init: RequestInit = {}, credential = phoneToken) => fetch(target, { ...init, headers: signedDeviceHeaders(phoneKeys.privateKey, credential, new URL(target).pathname + new URL(target).search, init.method ?? 'GET', typeof init.body === 'string' ? init.body : '', Object.fromEntries(new Headers(init.headers).entries())) });
      const phoneResponse = await deviceFetch(url, { headers: signedDeviceHeaders(phoneKeys.privateKey, phoneToken, new URL(url).pathname) });
      expect(phoneResponse.status).toBe(200);
      expect(await phoneResponse.json()).toMatchObject({ ok: true, payload: { conversationId: first.conversationId } });
      const phoneCreate = await deviceFetch(url, { method: 'POST',
    headers: signedDeviceHeaders(phoneKeys.privateKey, phoneToken, new URL(url).pathname, 'POST', '{}', { 'content-type': 'application/json' }), body: '{}' });
      expect(phoneCreate.status).toBe(200);
      expect(await phoneCreate.json()).toMatchObject({ ok: true, payload: { conversationId: first.conversationId } });
      const avatarWriter = vi.spyOn(agentsAdmin, 'writeAgentAvatarFromBase64').mockResolvedValue({ ok: true,
        data: { agentId: first.agentId, path: '/fixture/avatar.png' } });
      try {
        const avatarBody = JSON.stringify({ base64: 'fixture-base64', mimeType: 'image/png' });
        const avatarUrl = `${url}/avatar`;
        expect((await fetch(avatarUrl, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: avatarBody })).status).toBe(401);
        const phoneHeaders = { authorization: `Bearer ${phoneToken}`, 'content-type': 'application/json' };
        const uploaded = await deviceFetch(avatarUrl, { method: 'PUT', headers: phoneHeaders, body: avatarBody });
        expect(uploaded.status).toBe(200);
        expect(await uploaded.json()).toMatchObject({ ok: true, payload: { agentId: first.agentId } });
        expect(avatarWriter).toHaveBeenCalledWith(first.agentId, 'fixture-base64', 'image/png');
        expect((await deviceFetch(avatarUrl, { method: 'PUT', headers: phoneHeaders,
    body: JSON.stringify({ base64: 'fixture-base64', mimeType: 'image/png', agentId: 'other' }) })).status).toBe(400);
        expect((await deviceFetch(`${url.replace('/personal-agent', '')}/agents/other/avatar`, { method: 'PUT', headers: phoneHeaders, body: avatarBody })).status).toBe(403);
        expect(avatarWriter).toHaveBeenCalledTimes(1);
      } finally { avatarWriter.mockRestore(); }
      createDevice({ id: 'personal-extension', displayName: 'Extension', platform: 'chrome',
        extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', publicKeyJwk: phoneKeys.publicKey.export({ format: 'jwk' }), scopes: [...DEFAULT_MOBILE_SCOPES] });
      const extensionToken = issueDeviceTokenPair('personal-extension').accessToken;
      expect((await deviceFetch(url, { headers: { authorization: `Bearer ${extensionToken}` } }, extensionToken)).status).toBe(403);
      expect((await deviceFetch(`${url}/avatar`, { method: 'PUT', headers: { authorization: `Bearer ${extensionToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ base64: 'fixture', mimeType: 'image/png' }) }, extensionToken)).status).toBe(403);
      expect((await deviceFetch(onboardingUrl, { headers: { authorization: `Bearer ${extensionToken}` } }, extensionToken)).status).toBe(403);
      expect((await fetch(onboardingUrl, { method: 'PUT', headers,
        body: JSON.stringify({ step: 'voice', draft: { displayName: 'Other' } }) })).status).toBe(409);
      expect((await fetch(`${url}/activity`, { headers })).status).toBe(200);
      expect((await fetch(`${url}/activity?limit=5&offset=0`, { headers })).status).toBe(200);
      expect((await fetch(`${url}/activity?limit=0`, { headers })).status).toBe(400);
      expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ unknown: true }) })).status).toBe(400);
      expect((await fetch(`${url}/profile`, { method: 'PATCH', headers, body: JSON.stringify({ revision: -1 }) })).status).toBe(400);
    } finally {
      await automationService.stop();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('uses the same product default style for every Personal AI', () => {
    const gentle = personalInstructions();
    const direct = personalInstructions();
    expect(gentle).not.toContain('Joyce');
    expect(gentle).toContain('shared user profile');
    expect(gentle).toBe(direct);
    expect(direct).toContain('help name the core problem');
    expect(direct).not.toContain('Joyce');
    expect(direct).toContain('personal_task(command="submit")');
    expect(direct).toContain('requiredSkills=[canonicalName]');
    expect(direct).toContain('preserve that choice');
    expect(direct).toContain('The background Task Router selects and starts the executor');
    expect(direct).not.toContain('call delegate_task');
    expect(direct).toContain('Do not invent extra analyses');
    expect(direct).toContain('Answer directly when your capabilities suffice');
    expect(direct).toContain('ask one short question directly in your reply');
    expect(direct).toContain('Never use clarify');
    expect(direct).toContain('acknowledge once after confirmed persistence');
    expect(direct).toContain('Reuse the existing Task');
    expect(direct).toContain('For current news or other live facts');
  });

  it('keeps personal model and thinking preferences in its conversation without restricting ordinary Ada chats', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-personal-create-'));
    const previousStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = dir;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    try {
      const repository = new AgentCatalogRepository();
      repository.ensureInitialized();
      const settings = repository.getSettings();
      repository.updateDefaults({
        ...settings.defaults,
        models: { ...settings.defaults.models, intents: { fast: { primary: 'test/fast', fallbacks: [] } } },
      }, settings.revision);
      const gateway = { refreshAgentCatalog: () => {} } as unknown as GatewayService;
      const models = async () => [{ id: 'test/slow', name: 'Slow' }, { id: 'test/fast', name: 'Fast' }];
      const [first, second] = await Promise.all([
        createOrResumePersonalAgent(gateway, 'local-owner', undefined, models),
        createOrResumePersonalAgent(gateway, 'local-owner', undefined, models),
      ]);
      expect(first.state).toBe('ready');
      expect(second.conversationId).toBe(first.conversationId);
      expect(new AgentCatalogRepository().get(first.agentId)?.toolAllowlist).toContain('personal_task');
      expect(new AgentCatalogRepository().get(first.agentId)?.toolAllowlist).not.toContain('exec_command');
      for (const rule of PERSONAL_RELIABILITY_RULES) {
        expect(new AgentCatalogRepository().get(first.agentId)?.profile?.instructions).toContain(rule);
      }
      expect(new AgentCatalogRepository().get(first.agentId)?.skills).toEqual({ mode: 'replace', include: [] });
      expect(new AgentCatalogRepository().get(first.agentId)?.runtime?.thinkingLevel).toBeUndefined();
      expect(new AgentCatalogRepository().get(first.agentId)?.models?.chat).toMatchObject({ primary: 'test/fast', fallbacks: [] });
      expect(getSessionMetadata(first.conversationId)?.agentId).toBe(first.agentId);
      expect(getSessionMetadata(first.conversationId)?.hiddenFromSessionList).toBe(true);
      expect(getSessionConfig(first.conversationId)).toMatchObject({
        thinkingLevel: 'off', fixedModel: true, modelOverride: 'test/fast',
      });
      deleteSessionConfig(first.conversationId);
      expect(getPersonalAgent('local-owner')?.state).toBe('provisioning');
      const resumed = await createOrResumePersonalAgent(gateway, 'local-owner', undefined, models);
      expect(resumed.conversationId).toBe(first.conversationId);
      expect(resumed.state).toBe('ready');
      expect(getSqliteDatabase().prepare(`SELECT COUNT(*) AS count FROM sessions WHERE agent_id = ?`).get(first.agentId))
        .toMatchObject({ count: 1 });
      const sessionConfigStore = new SessionConfigStore('');
      const restore = vi.fn();
      const modelsById = ['fast', 'slow'].map(id => ({ provider: 'test', id,
        api: 'openai-responses', reasoning: true }) as Model<Api>);
      const modelManager = { findByRef: (ref: string) => modelsById.find(model => `test/${model.id}` === ref),
        getModelForSession: () => 'test/fast', restoreSessionModel: restore,
        getResolvedModelForSession: () => modelsById[1] };
      const runtime = { getAgent: () => null, setThinkingLevel: vi.fn() };
      const configService = new SessionConfigService({
        sessionStore: {} as never, sessionConfigStore,
        modelManager: modelManager as never, agentManager: runtime as never,
        getConfig: () => undefined,
      });
      const original = await sessionConfigStore.get(first.conversationId);
      await new AgentCatalogService().update(first.agentId, {
        models: { chat: { primary: 'test/slow', fallbacks: [] } },
      });
      expect(await sessionConfigStore.get(first.conversationId)).toEqual(original);
      expect(await configService.patch(first.conversationId, { model: 'test/slow' })).toEqual({ ok: true });
      const synchronized = await sessionConfigStore.get(first.conversationId);
      expect(synchronized).toMatchObject({ modelOverride: 'test/slow', thinkingLevel: 'off', fixedModel: true });
      expect(await configService.patch(first.conversationId, {
        model: 'test/fast', configVersion: original!.updatedAt,
      })).toMatchObject({ ok: false, code: 'CONFIG_CHANGED' });
      expect(await configService.patch(first.conversationId, { thinkingLevel: 'adaptive' }))
        .toMatchObject({ ok: false, code: 'INVALID_THINKING' });
      expect(await sessionConfigStore.get(first.conversationId)).toEqual(synchronized);
      expect(await configService.patch(first.conversationId, { thinkingLevel: 'high', configVersion: synchronized!.updatedAt }))
        .toEqual({ ok: true });
      expect(getPersonalAgent('local-owner')?.state).toBe('ready');
      expect(repository.get(first.agentId)?.runtime?.thinkingLevel).toBeUndefined();
      expect(await configService.patch(first.conversationId, { model: 'test/fast', thinkingLevel: 'off' }))
        .toEqual({ ok: true });
      expect(repository.get(first.agentId)?.models?.chat?.primary).toBe('test/slow');
      expect(await sessionConfigStore.get(first.conversationId)).toMatchObject({ modelOverride: 'test/fast', thinkingLevel: 'off' });
      expect(await configService.initializeModelSelection(first.conversationId, 'test/slow', 'high'))
        .toEqual({ ok: true });
      const hydrator = new SessionHydrator({ sessionConfigStore, modelManager: modelManager as never,
        agentManager: runtime as never, getConfig: () => undefined });
      await hydrator.model(first.conversationId);
      await hydrator.thinking(first.conversationId);
      expect(restore).toHaveBeenLastCalledWith(first.conversationId, 'test/slow', true);
      expect(runtime.setThinkingLevel).toHaveBeenLastCalledWith(first.conversationId, 'high');
      expect(await createOrResumePersonalAgent(gateway, 'local-owner', undefined, models)).toMatchObject({ state: 'ready' });
      expect(repository.get(first.agentId)?.runtime?.thinkingLevel).toBeUndefined();
      const ordinary = createConversation({ agentId: first.agentId, sourceChannel: 'webchat' }, dir);
      expect(isPersonalConversation(ordinary.key)).toBe(false);
      expect(await configService.patch(ordinary.key, { model: 'test/slow', thinkingLevel: 'high', fixedModel: true }))
        .toEqual({ ok: true });
      expect(await configService.patch(first.conversationId, { thinkingLevel: 'off' })).toEqual({ ok: true });
      expect(await sessionConfigStore.get(ordinary.key)).toMatchObject({ thinkingLevel: 'high' });
      expect(await createOrResumePersonalAgent(gateway, 'local-owner', undefined, models)).toMatchObject({ state: 'ready' });
      expect(await sessionConfigStore.get(first.conversationId)).toMatchObject({ modelOverride: 'test/slow', thinkingLevel: 'off' });
      expect(repository.get(first.agentId)?.runtime?.thinkingLevel).toBeUndefined();
      const readConfig = async () => {
        const config = (await sessionConfigStore.get(first.conversationId))!;
        return { model: config.modelOverride, thinkingLevel: config.thinkingLevel,
          configVersion: config.updatedAt, fixedModel: config.fixedModel };
      };
      const token = 'personal-model-config-token';
      let busy = false;
      const app = createHonoApp({ service: {
        currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
        getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
        isGatewayReady: () => true, getExtensionLoader: () => null,
        getSessionInputState: () => ({ inputs: busy ? [{}] : [] }),
        sessions: { getActiveRun: () => ({ active: false }),
          getSession: async (id: string) => getSessionMetadata(id),
          getAgentConfig: readConfig, getFixedAgentConfig: readConfig,
          patchAgentConfig: configService.patch.bind(configService) },
      } as unknown as GatewayService });
      const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
      try {
        if (!server.listening) await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing Gateway address');
        const url = `http://127.0.0.1:${address.port}/api/sessions/${first.conversationId}/agent-config`;
        const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
        expect((await fetch(url)).status).toBe(401);
        const selection = await readConfig();
        const response = await fetch(url, { method: 'PATCH', headers,
          body: JSON.stringify({ model: 'test/fast', thinkingLevel: 'off', configVersion: selection.configVersion }) });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ok: true, payload: { model: 'test/fast', thinkingLevel: 'off' } });
        expect(await (await fetch(url, { headers })).json()).toMatchObject({ payload: { model: 'test/fast', thinkingLevel: 'off' } });
        expect(repository.get(first.agentId)?.models?.chat?.primary).toBe('test/slow');
        busy = true;
        expect((await fetch(url, { method: 'PATCH', headers,
          body: JSON.stringify({ thinkingLevel: 'high' }) })).status).toBe(200);
        expect((await readConfig()).thinkingLevel).toBe('high');
      } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    } finally {
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
      else process.env.XOPC_STATE_DIR = previousStateDir;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
