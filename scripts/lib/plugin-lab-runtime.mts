import assert from 'node:assert/strict';
import { createAgentSession, createMcpExtension, createToolSearchExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import type { NativeMcpConfig } from '../../src/agent/mcp/native-mcp.js';
export async function invokePreparedTool(config: NativeMcpConfig, root: string, serverName: string, expected: string, invocation?: { toolDescription: string; arguments: Record<string, unknown> }) {
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager,
    noExtensions: true, noSkills: true, noContextFiles: true,
    extensionFactories: [createToolSearchExtension(), createMcpExtension({ loadConfig: () => ({ ...config, autoEnableCodemode: false }), credentials: config.credentials })],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
  await modelRuntime.setRuntimeApiKey('openai', 'fixture');
  const model: Model<'openai-completions'> = { id: 'fixture', name: 'Fixture', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const { session } = await createAgentSession({ cwd: root, agentDir: root, model, modelRuntime, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(), noTools: 'builtin' });
  try {
    await session.bindExtensions({}); await session.prompt('/mcp');
    const tool = session.getAllTools().find(tool => tool.namespace?.name === `mcp__${serverName.replace(/-/g, '_')}` && (!invocation || tool.description.includes(invocation.toolDescription)));
    assert(tool, `No tools discovered for ${serverName}: ${JSON.stringify(session.getAllTools().map(value => ({ name: value.name, namespace: value.namespace })))}`);
    const name = tool!.name;
    session.setActiveToolsByName([name]);
    let round = 0;
    session.agent.streamFunction = () => {
      const first = round++ === 0;
      const message: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: first ? [{ type: 'toolCall', id: 'fixture-call', name, arguments: invocation?.arguments ?? {} }] : [{ type: 'text', text: 'Done' }],
        stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { ...model.cost, total: 0 } } };
      const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: first ? 'toolUse' : 'stop', message }); return stream;
    };
    await session.prompt('Read the fixture note');
    const result = JSON.stringify(session.messages.findLast(message => message.role === 'toolResult')); assert(result.includes(expected), result); return result;
  } finally {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose();
  }
}
