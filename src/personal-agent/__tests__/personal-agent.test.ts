import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { describe, expect, it, vi } from 'vitest';
import type { Api, Model } from '@earendil-works/pi-ai';
import { SessionHydrator } from '../../agent/session/session-hydrator.js';

import { ConfigSchema } from '../../config/schema.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { AgentCatalogService } from '../../agent-catalog/service.js';
import { AgentToolsFactory } from '../../agent/tools/factory.js';
import { createPersonalTaskTool } from '../../agent/tools/personal-task-tool.js';
import { createPersonalPreferenceTool } from '../../agent/tools/personal-preference-tool.js';
import { applyUserProfilePatch, getUserProfileSnapshot } from '../../user-model/profile.js';
import { SessionConfigService } from '../../agent/session/session-config-service.js';
import { SessionConfigStore } from '../../session/config-store.js';
import type { MessageBus } from '../../infra/bus/index.js';
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
import { createOrResumePersonalAgent, ensurePersonalConversationVisibility, personalInstructions, refreshPersonalDelegationGuidance, updatePersonalProfileRecord } from '../service.js';

describe('personal Agent identity', () => {
  it('keeps one identity and conversation and serves it through the authenticated Gateway', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-personal-agent-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    const token = 'personal-agent-test-token';
    const app = createHonoApp({ service: {
      currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
      getResolvedAuth: () => ({ mode: 'token', token }),
      getAuthToken: () => token,
      isGatewayReady: () => true,
      getExtensionLoader: () => null,
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
      await createPersonalPreferenceTool({ getCurrentConversationId: () => conversationId })
        .execute('set-name', { field: 'addressAs', value: 'Nova' }, undefined, undefined as never);
      expect(getUserProfileSnapshot().callName).toBe('Nova');
      expect(getPersonalAgent('local-owner')?.preferences.addressAs).toBeUndefined();
      expect(getPersonalAgent('local-owner')?.revision).toBe(first.revision);
      applyUserProfilePatch({ callName: '' });
      expect(getPersonalAgent('local-owner')?.userCallName).toBeNull();
      expect(isPersonalConversation(first.conversationId)).toBe(true);
      const tools = new AgentToolsFactory({ workspace: dir, bus: {} as MessageBus,
        getCurrentContext: () => null, dispatchTaskRuns: () => {} })
        .createCoreTools({ agentId: first.agentId, conversationId: first.conversationId,
          toolAllowlist: ['xopc_use', 'exec_command', 'personal_task', 'personal_preference'] })
        .map(tool => tool.name);
      expect(tools).toContain('personal_task');
      expect(tools).toContain('personal_preference');
      expect(tools).toContain('xopc_use');
      expect(tools).toContain('exec_command');
      repository.create({ id: 'researcher', profile: { name: 'Research Assistant' },
        toolAllowlist: ['web_search'], tools: { web_fetch: { mode: 'deny' } } }, { ready: true });
      repository.create({ id: 'coder', profile: { name: 'Coding Expert' }, toolAllowlist: ['exec_command'] }, { ready: true });
      const agentsResult = await createPersonalTaskTool({
        getCurrentConversationId: () => conversationId,
        getCurrentAgentId: () => agentId,
      }).execute('list-agents', { command: 'agents' }, undefined, undefined as never);
      const candidates = JSON.parse(agentsResult.content[0]!.text as string) as Array<{ id: string; availableTools: string[] }>;
      expect(candidates.find(candidate => candidate.id === 'researcher')?.availableTools).toContain('web_search');
      expect(candidates.find(candidate => candidate.id === 'researcher')?.availableTools).not.toContain('web_fetch');
      const filtered = await createPersonalTaskTool({
        getCurrentConversationId: () => conversationId,
        getCurrentAgentId: () => agentId,
      }).execute('find-code-agent', { command: 'agents', requiredTools: ['exec_command'] }, undefined, undefined as never);
      const codeCandidates = JSON.parse(filtered.content[0]!.text as string) as Array<{ id: string }>;
      expect(codeCandidates.map(candidate => candidate.id)).toContain('coder');
      expect(codeCandidates.map(candidate => candidate.id)).not.toContain('researcher');
      expect(await updatePersonalProfileRecord('local-owner', 999, '阿沐', {}, 'spark')).toBeNull();
      const updated = await updatePersonalProfileRecord('local-owner', first.revision, '阿沐',
        { warmth: 'gentle', guidance: 'When I am anxious, offer one concrete step before asking questions.' }, 'cloud');
      expect(updated?.revision).toBe(first.revision + 1);
      expect(getPersonalAgent('local-owner')?.displayName).toBe('阿沐');
      expect(repository.get(agentId)?.profile?.responsePreferences).toMatchObject({ warmth: 'gentle',
        guidance: 'When I am anxious, offer one concrete step before asking questions.' });
      expect(repository.get(agentId)?.profile?.instructions).toContain('offer one concrete step before asking questions');
      expect(getSqliteDatabase().prepare("SELECT name FROM sqlite_master WHERE name = 'personal_agents'").get()).toBeUndefined();

      expect((await fetch(url)).status).toBe(401);
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, payload: { displayName: '阿沐', conversationId: first.conversationId } });
      createDevice({ id: 'personal-phone', displayName: 'Phone', platform: 'harmonyos',
        publicKeyJwk: { kty: 'EC' }, scopes: [...DEFAULT_MOBILE_SCOPES] });
      const phoneToken = issueDeviceTokenPair('personal-phone').accessToken;
      const phoneResponse = await fetch(url, { headers: { authorization: `Bearer ${phoneToken}` } });
      expect(phoneResponse.status).toBe(200);
      expect(await phoneResponse.json()).toMatchObject({ ok: true, payload: { conversationId: first.conversationId } });
      const phoneCreate = await fetch(url, { method: 'POST',
        headers: { authorization: `Bearer ${phoneToken}`, 'content-type': 'application/json' }, body: '{}' });
      expect(phoneCreate.status).toBe(200);
      expect(await phoneCreate.json()).toMatchObject({ ok: true, payload: { conversationId: first.conversationId } });
      createDevice({ id: 'personal-extension', displayName: 'Extension', platform: 'chrome',
        extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', publicKeyJwk: { kty: 'EC' }, scopes: [...DEFAULT_MOBILE_SCOPES] });
      const extensionToken = issueDeviceTokenPair('personal-extension').accessToken;
      expect((await fetch(url, { headers: { authorization: `Bearer ${extensionToken}` } })).status).toBe(403);
      expect((await fetch(onboardingUrl, { headers: { authorization: `Bearer ${extensionToken}` } })).status).toBe(403);
      expect((await fetch(onboardingUrl, { method: 'PUT', headers,
        body: JSON.stringify({ step: 'voice', draft: { displayName: 'Other' } }) })).status).toBe(409);
      expect((await fetch(`${url}/activity`, { headers })).status).toBe(200);
      expect((await fetch(`${url}/activity?limit=5&offset=0`, { headers })).status).toBe(200);
      expect((await fetch(`${url}/activity?limit=0`, { headers })).status).toBe(400);
      expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ unknown: true }) })).status).toBe(400);
      expect((await fetch(`${url}/profile`, { method: 'PATCH', headers, body: JSON.stringify({ revision: -1 }) })).status).toBe(400);
    } finally {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('builds a distinct short speaking style from explicit preferences', () => {
    const gentle = personalInstructions({ addressAs: 'Joyce', warmth: 'gentle', supportMode: 'listen' });
    const direct = personalInstructions({ warmth: 'reserved', supportMode: 'solutions', humor: 'none' });
    expect(gentle).not.toContain('Joyce');
    expect(gentle).toContain('shared user profile');
    expect(gentle).toContain('listen and reflect');
    expect(direct).toContain('concrete next step');
    expect(direct).not.toContain('Joyce');
    expect(direct).toContain('personal_task(command="agents")');
    expect(direct).toContain('If you cannot reliably do it yourself');
    expect(direct).toContain('If the chosen Agent or tool cannot complete the Task');
    expect(direct).toContain('For current news or other live facts');
  });

  it('defaults thinking off and keeps Personal AI model settings synchronized with its Agent', async () => {
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
      expect(new AgentCatalogRepository().get(first.agentId)?.skills).toEqual({ mode: 'replace', include: [] });
      expect(new AgentCatalogRepository().get(first.agentId)?.runtime?.thinkingLevel).toBe('off');
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
      expect(repository.get(first.agentId)?.runtime?.thinkingLevel).toBe('high');
      expect(await configService.patch(first.conversationId, { model: 'test/fast', thinkingLevel: 'off' }))
        .toEqual({ ok: true });
      expect(repository.get(first.agentId)?.models?.chat?.primary).toBe('test/fast');
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
      expect(repository.get(first.agentId)?.runtime?.thinkingLevel).toBe('high');
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
        expect(repository.get(first.agentId)?.models?.chat?.primary).toBe('test/fast');
        busy = true;
        expect((await fetch(url, { method: 'PATCH', headers,
          body: JSON.stringify({ thinkingLevel: 'high' }) })).status).toBe(409);
        expect((await readConfig()).thinkingLevel).toBe('off');
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

  it('refreshes existing generated delegation guidance without changing custom instructions twice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-personal-guidance-'));
    const previousStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = dir;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    try {
      const repository = new AgentCatalogRepository();
      repository.ensureInitialized();
      const agentId = personalAgentId('local-owner');
      repository.create({ id: agentId, profile: { name: 'Personal AI', responsePreferences: { addressAs: 'Legacy name' }, instructions: [
        'Answer simple requests directly. For complex work, use personal_task agents to find a suitable specialist, then create a Task and remain available to talk. Never claim a task was created before the tool confirms it.',
        'Keep my custom instruction.',
        'Address the user as "Legacy name" when a name fits naturally.',
      ].join('\n') } }, { ready: true });
      const gateway = { refreshAgentCatalog: () => {}, agentService: { evictSessionAgent: () => {} } } as unknown as GatewayService;
      await refreshPersonalDelegationGuidance(gateway, 'local-owner');
      const refreshed = repository.get(agentId)!;
      expect(refreshed.profile?.instructions).toContain('For current news or other live facts');
      expect(refreshed.profile?.instructions).toContain('Keep my custom instruction.');
      expect(refreshed.profile?.instructions).not.toContain('Legacy name');
      expect(refreshed.profile?.instructions).toContain('shared user profile');
      expect(refreshed.profile?.instructions).toContain('Do not include task progress links by default');
      expect(refreshed.profile?.instructions).toContain('it does not prove execution has started');
      expect(refreshed.profile?.instructions).toContain('Speak like an attentive, reliable collaborator');
      await refreshPersonalDelegationGuidance(gateway, 'local-owner');
      expect(repository.get(agentId)?.revision).toBe(refreshed.revision);
      const previousGuidance = [
        'Route by required capability, not task length. Answer directly only when your own tools and knowledge are sufficient. For current facts, web pages, or any tool you lack, call personal_task(command="agents"), choose an Agent with the needed availableTools, then create a Task. Your own lack of browsing does not mean xopc cannot browse. Never claim the system cannot help, ask the user to switch models, or ask them to paste sources before checking Agents.',
        'For current news, delegate to an Agent with web_search. Include the requested date or time window and topic in the brief; require source links, publication dates, and a distinction between confirmed news and uncertain reports. Tell the user briefly that you are checking. Stay available while the Task runs, then summarize verified results in their preferred style.',
        'If no suitable Agent is available, explain the specific missing capability and offer the next useful option. Never claim a Task was created before the tool confirms it.',
        'Keep my custom instruction.',
      ].join('\n');
      await new AgentCatalogService().update(agentId, {
        profile: { ...refreshed.profile!, instructions: previousGuidance },
      }, refreshed.revision);
      await refreshPersonalDelegationGuidance(gateway, 'local-owner');
      expect(repository.get(agentId)?.profile?.instructions).toContain('If the chosen Agent or tool cannot complete the Task');
      expect(repository.get(agentId)?.profile?.instructions).toContain('Keep my custom instruction.');
      const prior = repository.get(agentId)!;
      const priorInstructions = prior.profile!.instructions!.split('\n').filter((_, index) => index !== 2).join('\n');
      await new AgentCatalogService().update(agentId, {
        profile: { ...prior.profile!, instructions: priorInstructions },
      }, prior.revision);
      await refreshPersonalDelegationGuidance(gateway, 'local-owner');
      expect(repository.get(agentId)?.profile?.instructions).toContain('A worker question is yours to resolve first');
      expect(repository.get(agentId)?.profile?.instructions).toContain('Keep my custom instruction.');
    } finally {
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
      else process.env.XOPC_STATE_DIR = previousStateDir;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
