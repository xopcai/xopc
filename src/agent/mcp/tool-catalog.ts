import { join } from 'node:path';

import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import {
  createAgentSession, createMcpExtension, createToolSearchExtension, DefaultResourceLoader,
  ModelRuntime, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';

import type { Config } from '../../config/schema.js';
import { createEmbeddedModelRuntime } from '../embedded/model-runtime.js';
import type { NativeMcpCredentials } from './credential-store.js';
import { getNativePiAgentDir, prepareNativeMcpConfig } from './native-mcp.js';

export type McpCatalogTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  exposure?: string;
};

export class McpAuthenticationRequiredError extends Error {}

export type McpLoginInteraction = {
  signal: AbortSignal;
  onAuthorizationUrl: (url: string) => void;
  requestRedirectUrl: (signal?: AbortSignal) => Promise<string | undefined>;
};

export type McpSessionOptions = { credentials?: NativeMcpCredentials; signal?: AbortSignal };

/** A short-lived native session discovers tools without making a model request. */
export async function discoverMcpTools(config: Config, workspaceDir: string, serverId: string, options?: McpSessionOptions): Promise<McpCatalogTool[]> {
  return runNativeMcpSession(config, workspaceDir, serverId, undefined, options);
}

/** Native pi owns PKCE, registration, callbacks, token storage and refresh. */
export async function signInNativeMcp(config: Config, workspaceDir: string, serverId: string,
  interaction: McpLoginInteraction, options?: McpSessionOptions): Promise<McpCatalogTool[]> {
  return runNativeMcpSession(config, workspaceDir, serverId, interaction, options);
}

async function runNativeMcpSession(config: Config, workspaceDir: string, serverId: string,
  interaction?: McpLoginInteraction, options?: McpSessionOptions): Promise<McpCatalogTool[]> {
  const signal = interaction?.signal ?? options?.signal;
  signal?.throwIfAborted();
  const loaded = await prepareNativeMcpConfig(config, workspaceDir);
  signal?.throwIfAborted();
  const entry = loaded.servers.find(server => server.name === serverId);
  if (!entry) throw new Error(`MCP server "${serverId}" is not configured or has invalid configuration.`);
  if (entry.config.enabled === false) throw new Error(`MCP server "${serverId}" is disabled.`);
  const agentDir = getNativePiAgentDir();
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: workspaceDir, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [createToolSearchExtension(), createMcpExtension({
      credentials: options?.credentials ?? loaded.credentials,
      loadConfig: () => ({ servers: [entry], errors: [], autoEnableCodemode: false }),
      logPath: join(agentDir, 'mcp.log'),
      openUrl: url => interaction?.onAuthorizationUrl(url),
    })],
  });
  await loader.reload();
  signal?.throwIfAborted();
  const provider = 'url' in entry.config ? entry.config.auth?.provider : undefined;
  const modelRuntime = provider ? await createEmbeddedModelRuntime(provider) : await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, refreshOnCreate: false,
  });
  signal?.throwIfAborted();
  const { session } = await createAgentSession({ cwd: workspaceDir, agentDir, resourceLoader: loader,
    settingsManager, modelRuntime, sessionManager: SessionManager.inMemory(), noTools: 'builtin' });
  let failure: string | undefined;
  let signedIn = false;
  let shutdown: Promise<unknown> | undefined;
  const close = () => shutdown ??= session.extensionRunner?.emit({ type: 'session_shutdown', reason: 'quit' }) ?? Promise.resolve();
  const abort = () => { void close(); };
  try {
    const runner = session.extensionRunner;
    if (!runner) throw new Error('Native MCP extension is unavailable.');
    signal?.throwIfAborted();
    signal?.addEventListener('abort', abort, { once: true });
    await session.bindExtensions({ uiContext: { ...runner.getUIContext(), notify(message) {
      if (message.startsWith('MCP servers need attention:') || message.startsWith('MCP failed to load:')) failure = message;
      if (message.startsWith('Signed in to MCP server')) signedIn = true;
      if (message.startsWith('Sign-in ') || message.startsWith('Signed in, but')) failure = message;
    }, input(_title, _placeholder, options) {
      return interaction?.requestRedirectUrl(options?.signal) ?? Promise.resolve(undefined);
    } } });
    if (signal?.aborted) throw new Error('MCP sign-in cancelled.');
    // The native command waits for connection and catalog discovery; it never prompts a model.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([session.prompt('/mcp'), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('MCP tool discovery timed out.')), 60_000);
      })]);
    } finally {
      clearTimeout(timer);
    }
    if (interaction) {
      // Startup reports a pending authorization; the login command handles it.
      failure = undefined;
      await session.prompt(`/mcp login ${serverId}`);
      if (interaction.signal.aborted) throw new Error('MCP sign-in cancelled.');
      if (failure || !signedIn) throw new Error(failure ?? 'MCP sign-in did not complete.');
    } else if (failure) {
      if (/needs sign-in|needs-auth/.test(failure)) throw new McpAuthenticationRequiredError(failure);
      throw new Error(failure);
    }
    if (signal?.aborted) throw new Error('MCP connection check cancelled.');
    const namespace = `mcp__${serverId.replace(/-/g, '_')}`;
    return session.getAllTools().filter(tool => tool.namespace?.name === namespace).map(tool => ({
      name: tool.name, description: tool.description, inputSchema: tool.parameters, exposure: tool.exposure,
    })).sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    try {
      signal?.removeEventListener('abort', abort);
      await close();
    } finally {
      session.dispose();
    }
  }
}
