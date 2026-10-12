import { join } from 'node:path';

import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import {
  createAgentSession, createMcpExtension, createToolSearchExtension, DefaultResourceLoader,
  ModelRuntime, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';

import type { Config } from '../../config/schema.js';
import { createEmbeddedModelRuntime } from '../embedded/model-runtime.js';
import { getNativePiAgentDir, prepareNativeMcpConfig } from './native-mcp.js';

export type McpCatalogTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  exposure?: string;
};

/** A short-lived native session discovers tools without making a model request. */
export async function discoverMcpTools(config: Config, workspaceDir: string, serverId: string): Promise<McpCatalogTool[]> {
  const loaded = await prepareNativeMcpConfig(config, workspaceDir);
  const entry = loaded.servers.find(server => server.name === serverId);
  if (!entry) throw new Error(`MCP server "${serverId}" is not configured or has invalid configuration.`);
  if (entry.config.enabled === false) throw new Error(`MCP server "${serverId}" is disabled.`);
  const agentDir = getNativePiAgentDir();
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: workspaceDir, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [createToolSearchExtension(), createMcpExtension({
      loadConfig: () => ({ servers: [entry], errors: [], autoEnableCodemode: false }),
      logPath: join(agentDir, 'mcp.log'),
    })],
  });
  await loader.reload();
  const provider = 'url' in entry.config ? entry.config.auth?.provider : undefined;
  const modelRuntime = provider ? await createEmbeddedModelRuntime(provider) : await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, refreshOnCreate: false,
  });
  const { session } = await createAgentSession({ cwd: workspaceDir, agentDir, resourceLoader: loader,
    settingsManager, modelRuntime, sessionManager: SessionManager.inMemory(), noTools: 'builtin' });
  let failure: string | undefined;
  try {
    const runner = session.extensionRunner;
    if (!runner) throw new Error('Native MCP extension is unavailable.');
    await session.bindExtensions({ uiContext: { ...runner.getUIContext(), notify(message) {
      if (message.startsWith('MCP servers need attention:') || message.startsWith('MCP failed to load:')) failure = message;
    } } });
    // The native command waits for connection and catalog discovery; it never prompts a model.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([session.prompt('/mcp'), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('MCP tool discovery timed out.')), 60_000);
      })]);
    } finally {
      clearTimeout(timer);
    }
    if (failure) throw new Error(failure);
    const namespace = `mcp__${serverId.replace(/-/g, '_')}`;
    return session.getAllTools().filter(tool => tool.namespace?.name === namespace).map(tool => ({
      name: tool.name, description: tool.description, inputSchema: tool.parameters, exposure: tool.exposure,
    })).sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    try {
      await session.extensionRunner?.emit({ type: 'session_shutdown', reason: 'quit' });
    } finally {
      session.dispose();
    }
  }
}
