import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { FollowUpAgentExecutor } from '../agentExecutor.js';
import { verifyTaskWorkspace } from '../../../agent/commands/approved-verification.js';
import { ConfigSchema } from '../../../config/schema.js';
import { SessionStore } from '../../../session/store.js';
import { onSessionTranscriptUpdate } from '../../../session/transcript-events.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';

const runtimeFixture = vi.hoisted(() => ({ endpoint: '' }));
vi.mock('../../../agent/embedded/model-runtime.js', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryModelsStore, InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  return { resolveEmbeddedProviderApiKeySync: () => 'fixture-only', createEmbeddedModelRuntime: async () => {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
    runtime.registerProvider('fixture-model', { baseUrl: runtimeFixture.endpoint, api: 'openai-completions', models: [] });
    await runtime.setRuntimeApiKey('fixture-model', 'fixture-only');
    return runtime;
  } };
});

describe('shared embedded task harness', () => {
  let directory: string;
  let server: Server;
  let endpoint: string;
  let requests: Array<Record<string, any>>;
  let steps: Array<{ tool: string; args: unknown }>;
  let rawFinal: boolean;
  let conversationId: string;
  let unsubscribe: () => void;
  let persisted: Promise<void>[];
  const config = ConfigSchema.parse({});
  beforeEach(async () => {
    vi.stubEnv('OPENAI_API_KEY', 'fixture-only');
    directory = mkdtempSync(join(tmpdir(), 'xopc-development-agent-'));
    writeFileSync(join(directory, 'app.js'), 'export const value = 1;\n');
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'state.db') });
    seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: directory }] });
    conversationId = createConversation({ agentId: 'main', sourceChannel: 'webchat', sourceChatId: 'fixture' }).key;
    const store = new SessionStore({ config });
    persisted = [];
    // Mirror the application-owned AgentService writer, not a second executor sink.
    unsubscribe = onSessionTranscriptUpdate(update => { if (update.conversationId === conversationId) persisted.push(store.syncEmbeddedTranscriptUpdate(update)); });
    requests = []; steps = []; rawFinal = false;
    server = createServer(async (request, response) => {
      let body = ''; for await (const chunk of request) body += chunk;
      requests.push(JSON.parse(body));
      const step = steps[requests.length - 1] ?? (!rawFinal ? { tool: 'structured_output', args: { summary: 'Updated current evidence', needsUser: false, continueAutomatically: false, remainingWork: [] } } : undefined);
      const delta = step ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args) } }] }
        : { role: 'assistant', content: 'Unstructured answer' };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o-mini', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o-mini', choices: [{ index: 0, delta: {}, finish_reason: step ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    runtimeFixture.endpoint = endpoint;
  });
  afterEach(async () => {
    unsubscribe(); await Promise.all(persisted);
    vi.unstubAllEnvs();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });
  const guard = () => {};
  const verify = async () => ({ passed: true, output: 'fixture test passed' });
  function run(writable = true, workspaceRead = true) {
    const agent = new FollowUpAgentExecutor(() => ({ id: 'gpt-4o-mini', name: 'Local fixture', provider: 'fixture-model', api: 'openai-completions',
      baseUrl: endpoint, reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 4000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }), () => config);
    return agent.execute({ runId: 'test', conversationId, workspace: directory, goal: 'Change value to 2', instruction: 'Use current requirements only',
      evidence: 'Untrusted source', capabilities: workspaceRead ? ['workspace.read', ...(writable ? ['workspace.write' as const, 'verification.run' as const] : [])] : [],
      signal: AbortSignal.timeout(15000), guard, verify });
  }

  it('runs the real pi tool loop through a local model endpoint and persists code edits', async () => {
    steps = [{ tool: 'read_file', args: { path: 'app.js' } }, { tool: 'write_file', args: { path: 'app.js', content: 'export const value = 2;\n' } },
      { tool: 'verify_project', args: {} }];
    expect((await run()).needsUser).toBe(false);
    expect(readFileSync(join(directory, 'app.js'), 'utf8')).toContain('value = 2');
    expect(requests).toHaveLength(4);
    expect(JSON.stringify(requests[0].messages)).toContain('do not wait for hypothetical future requirements');
    expect(JSON.stringify(requests[0].messages)).toContain('remainingWork includes only currently unmet requirements');
    expect(requests[0].tools.map((tool: any) => tool.function.name).sort()).toEqual(['list_directory', 'read_file', 'structured_output', 'verify_project', 'write_file']);
  });

  it('does not expose mutation, shell, connector or delegation tools during investigation', async () => {
    steps = [{ tool: 'write_file', args: { path: 'app.js', content: 'not allowed' } }];
    await run(false);
    expect(readFileSync(join(directory, 'app.js'), 'utf8')).toContain('value = 1');
    expect(requests[0].tools.map((tool: any) => tool.function.name).sort()).toEqual(['list_directory', 'read_file', 'structured_output']);
  });

  it('blocks credential reads and metadata writes even through an alias', async () => {
    writeFileSync(join(directory, '.env'), 'synthetic-secret');
    writeFileSync(join(directory, '.git'), 'gitdir: fixture');
    symlinkSync(join(directory, '.git'), join(directory, 'alias'));
    steps = [{ tool: 'read_file', args: { path: '.env' } }, { tool: 'write_file', args: { path: 'alias', content: 'corrupted' } }];
    await run();
    expect(JSON.stringify(requests)).not.toContain('synthetic-secret');
    expect(readFileSync(join(directory, '.git'), 'utf8')).toBe('gitdir: fixture');
  });

  it('rejects unpinned verification images without running a host command', async () => {
    await expect(verifyTaskWorkspace({ workspace: directory, command: 'echo unsafe > app.js', image: 'node:latest', guard,
      signal: AbortSignal.timeout(1000) })).rejects.toThrow('sha256');
    expect(readFileSync(join(directory, 'app.js'), 'utf8')).toContain('value = 1');
  });

  it('rejects overwrites without reading the existing file', async () => {
    steps = [{ tool: 'write_file', args: { path: 'app.js', content: 'overwritten' } }];
    await run();
    expect(readFileSync(join(directory, 'app.js'), 'utf8')).toContain('value = 1');
    expect(JSON.stringify(requests)).toContain('Read the existing file');
  });

  it('requires a structured result instead of trusting an unstructured completion claim', async () => {
    rawFinal = true;
    await expect(run()).rejects.toThrow('valid result');
  });

  it('runs a no-file analysis task with only the structured receipt tool', async () => {
    await run(false, false);
    expect(requests[0].tools.map((tool: any) => tool.function.name)).toEqual(['structured_output']);
  });

  it('persists tool evidence in the existing task conversation for the next source update', async () => {
    steps = [{ tool: 'read_file', args: { path: 'app.js' } }];
    await run(false);
    await Promise.all(persisted);
    const messages = await new SessionStore({ config }).loadMessages(conversationId);
    expect(messages.some(message => message.role === 'toolResult')).toBe(true);
    requests = []; steps = [];
    await run(false);
    expect(JSON.stringify(requests[0].messages)).toContain('value = 1');
  });
});
