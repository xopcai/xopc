import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type Model, type Api } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, setSessionConfig } from '../../../storage/sqlite/index.js';
import { AGENT_PROFILE_CONTEXT_STATE, agentProfileContextFingerprint, createAgentProfileContextExtension } from '../agent-profile-context.js';
import { buildSystemPrompt } from '../../prompt/system-prompt.js';

let catalog: AgentCatalogRepository;
let conversationId: string;
beforeEach(() => {
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: ':memory:' });
  catalog = new AgentCatalogRepository();
  catalog.ensureInitialized();
  catalog.create({ id: 'identity-test', profile: { name: 'Mira', description: 'Botany educator', language: 'en' } }, { ready: true });
  conversationId = createConversation({ agentId: 'identity-test' }).key;
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

describe('Agent profile runtime context', () => {
  it('sends the current native SDK prompt as one leading system message while preserving the user question', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xopc-profile-context-'));
    let session: AgentSession | undefined;
    const model: Model<Api> = { id: 'fixture', name: 'Fixture', provider: 'openai', api: 'openai-completions',
      baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 128000,
      maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    try {
      const agent = catalog.get('identity-test')!;
      catalog.update(agent.id, agent.revision, { id: agent.id, profile: { name: 'Orion', description: 'Astronomy educator', language: 'fr' } });
      const manager = SessionManager.inMemory(dir);
      manager.appendMessage({ role: 'system', content: 'OLD SYSTEM PROFILE: Mira, botany, English.', timestamp: 1 });
      manager.appendMessage({ role: 'user', content: 'Earlier question', timestamp: 2 });
      const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
      const resourceLoader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager,
        noExtensions: true, noContextFiles: true, systemPrompt: buildSystemPrompt(dir, { agentProfile: catalog.get(agent.id)!.profile }),
        extensionFactories: [createAgentProfileContextExtension(conversationId)] });
      await resourceLoader.reload();
      const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(),
        modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
      await modelRuntime.setRuntimeApiKey('openai', 'fixture');
      ({ session } = await createAgentSession({ cwd: dir, model, resourceLoader, settingsManager,
        modelRuntime, sessionManager: manager, noTools: 'builtin', tools: ['identity_probe'], customTools: [{
          name: 'identity_probe', label: 'Probe', description: 'Probe current declarations', parameters: Type.Object({}),
          promptGuidelines: ['Keep the current probe guideline.'],
          async execute() { return { content: [{ type: 'text', text: 'Probe' }], details: {} }; },
        }] }));
      await session.bindExtensions({});
      let captured: unknown[] = [];
      session.agent.streamFunction = (_model, context) => {
        captured = context.messages;
        const message: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text: 'Fixture reply' }],
          api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: Date.now(),
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { ...model.cost, total: 0 } } };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: 'done', reason: 'stop', message });
        return stream;
      };
      const question = 'Describe your current specialty.';
      await session.prompt(question);
      const sent = captured as { role: string; content: unknown }[];
      expect(sent.filter(message => message.role === 'system')).toHaveLength(1);
      expect(sent[0].role).toBe('system');
      const prompt = getCurrentSystemPrompt(captured as never);
      expect(prompt).toContain('You are "Orion".');
      expect(prompt).toContain('Your current role is "Astronomy educator".');
      expect(sent.some(message => message.role === 'user' && JSON.stringify(message.content)
        .includes('agent_configuration_updated'))).toBe(true);
      expect(prompt).toContain('Write all user-facing prose in French.');
      expect(prompt).toContain('<cwd>');
      expect(getCurrentTools(captured as never).map(tool => tool.name)).toContain('identity_probe');
      expect(prompt).not.toContain('OLD SYSTEM PROFILE');
      expect(sent.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text', text: question }] });
      expect(sent).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Earlier question' })]));
    } finally {
      session?.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('recognizes changes to identity fields while ignoring display-only changes', () => {
    const profile = { name: 'Mira', description: 'Botany educator', language: 'en', style: 'Formal' };
    const before = agentProfileContextFingerprint('agent', profile);
    for (const patch of [{ name: 'Orion' }, { description: 'Astronomy educator' }, { language: 'fr' }, { style: 'Casual' }, { instructions: 'Be concise.' }])
      expect(agentProfileContextFingerprint('agent', { ...profile, ...patch })).not.toBe(before);
    expect(agentProfileContextFingerprint('agent', { ...profile, avatar: 'xopc:custom', emoji: '✨' })).toBe(before);
    expect(agentProfileContextFingerprint('other-agent', profile)).not.toBe(before);
    expect(agentProfileContextFingerprint('agent', profile, 'zh-CN')).not.toBe(before);
  });

  it('announces configuration transitions once, including after runner recreation', () => {
    const entries: any[] = [];
    let handler: any;
    const handlers: Record<string, any> = {};
    const pi = { on: (event: string, callback: any) => { handlers[event] = callback; },
      appendEntry: (customType: string, data: unknown) => entries.push({ type: 'custom', customType, data }) };
    const context = { sessionManager: { getBranch: () => entries }, getSystemPrompt: () => 'CURRENT SYSTEM PROFILE AND TOOL GUIDANCE' };
    createAgentProfileContextExtension(conversationId)(pi as never);
    const event = { systemPrompt: 'CURRENT SYSTEM PROFILE AND TOOL GUIDANCE' };
    handler = (_event: any, ctx: any) => {
      handlers.before_agent_start(event, ctx);
      const projected = handlers.context_with_system({ messages: [{ role: 'user', content: 'Question', timestamp: 1 }] }, ctx);
      return { message: projected.messages.find((message: any) => message.role === 'custom') };
    };
    expect(JSON.parse(handler(event, context).message.content).current).toMatchObject({ name: 'Mira', role: 'Botany educator' });
    expect(entries).toHaveLength(1);
    expect(entries[0].customType).toBe(AGENT_PROFILE_CONTEXT_STATE);
    expect(Object.keys(entries[0].data)).toEqual(['fingerprint', 'configuration']);
    expect(entries[0].data.configuration).toMatchObject({ name: 'Mira', role: 'Botany educator', primaryLanguage: 'en' });
    expect(JSON.parse(handler(event, context).message.content).event).toBe('agent_configuration_current');
    expect(entries).toHaveLength(1);
    createAgentProfileContextExtension(conversationId)(pi as never);
    expect(JSON.parse(handler(event, context).message.content).event).toBe('agent_configuration_current');
    expect(entries).toHaveLength(1);
    const agent = catalog.get('identity-test')!;
    catalog.update(agent.id, agent.revision, { id: agent.id, profile: { name: 'Orion', description: 'Astronomy educator', language: 'fr' } });
    const updated = handler(event, context);
    expect(JSON.parse(updated.message.content)).toMatchObject({ event: 'agent_configuration_updated',
      changedFields: ['name', 'role', 'primaryLanguage'], current: { name: 'Orion', role: 'Astronomy educator', primaryLanguage: 'fr' },
      updates: { name: { previous: 'Mira', current: 'Orion' } } });
    expect(updated.message.display).toBe(false);
    expect(entries).toHaveLength(2);
    setSessionConfig(conversationId, { responseLanguage: 'zh-CN' });
    expect(JSON.parse(handler(event, context).message.content).changedFields).toEqual(['responseLanguageOverride']);
    expect(entries).toHaveLength(3);
    const current = catalog.get(agent.id)!;
    catalog.update(agent.id, current.revision, { id: agent.id, profile: { name: 'Orion' } });
    const cleared = JSON.parse(handler(event, context).message.content);
    expect(cleared.current).toMatchObject({ role: null, style: null, primaryLanguage: null });
    expect(cleared.updates.role).toEqual({ previous: 'Astronomy educator', current: null });
    expect(event.systemPrompt).toBe('CURRENT SYSTEM PROFILE AND TOOL GUIDANCE');
  });
});
