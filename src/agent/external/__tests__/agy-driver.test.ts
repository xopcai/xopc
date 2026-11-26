import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { ProjectStore } from '../../../projects/project-store.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../storage/sqlite/connection.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { setSessionInteractionPolicy } from '../../session/interaction-policy.js';
import { resolveAgySpawnSpec } from '../drivers/agy/driver.js';
import {
  disposeAllPooledExternalSessions,
  disposePooledExternalSession,
  getExternalAgentDriver,
  getPooledExternalSessionCount,
  hasExternalSessionBinding,
  probeExternalAgentRuntime,
  resolveExternalInteraction,
  runExternalProjectTurn,
  steerExternalTurn,
} from '../index.js';

function createFakeAgyBinary(dir: string, logFile: string, mode: 'normal' | 'load_only' | 'auth_url' | 'cancel' | 'interactive'): string {
  const scriptPath = join(dir, 'fake-agy');
  const script = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const logFile = ${JSON.stringify(logFile)};
const mode = ${JSON.stringify(mode)};
const log = (entry) => appendFileSync(logFile, JSON.stringify(entry) + '\\n');
const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');

let activePromptId = null;
const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  log(msg);
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentInfo: { name: 'antigravity', version: '1.5.8' },
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true },
          sessionCapabilities: mode === 'load_only' ? {} : { resume: {} },
          _meta: { antigravity: { systemPrompt: { append: true } } },
        },
        authMethods: [{ id: 'oauth-personal', type: 'agent' }],
      },
    });
    return;
  }
  if (msg.method === 'session/new') {
    if (mode === 'auth_url') {
      process.stdout.write('Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/v2/auth?state=x&redirect_uri=http://127.0.0.1:4321/&response_type=code\\n');
      return;
    }
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        sessionId: 'agy-session-1',
        configOptions: [{
          id: 'model',
          type: 'select',
          currentValue: 'gemini-3-pro',
          options: [
            { value: 'gemini-3-pro', name: 'Gemini 3 Pro' },
            { value: 'gemini-3-flash', name: 'Gemini 3 Flash' },
          ],
        }],
      },
    });
    return;
  }
  if (msg.method === 'session/set_config_option') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {},
    });
    return;
  }
  if (msg.method === 'session/resume') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { sessionId: msg.params.sessionId },
    });
    return;
  }
  if (msg.method === 'session/load') {
    // Emit a historical replay notification before session/load resolves — must be ignored!
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: msg.params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Replayed history should be ignored' },
        },
      },
    });
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { sessionId: msg.params.sessionId },
    });
    return;
  }
  if (msg.method === 'session/prompt') {
    const sid = msg.params.sessionId;
    if (mode === 'cancel') {
      activePromptId = msg.id;
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: sid,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working...' } },
        },
      });
      return;
    }
    // 1. Thought chunk + ACP plan update
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: sid,
        update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Checking files' } },
      },
    });
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: sid,
        update: {
          sessionUpdate: 'plan',
          entries: [
            { content: 'Inspect files', status: 'in_progress' },
            { content: 'Update README', status: 'pending' },
          ],
        },
      },
    });
    // 2. Ignored internal update_steps tool call
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: sid,
        update: { sessionUpdate: 'tool_call', toolCallId: 'steps-1', title: 'Run update_steps', status: 'in_progress' },
      },
    });
    // 3. Permission request for shell command (+ interactive question only in interactive mode)
    send({
      jsonrpc: '2.0',
      id: 'perm-1',
      method: 'session/request_permission',
      params: {
        sessionId: sid,
        toolCall: { toolCallId: 'cmd-1', kind: 'execute', title: 'Run pwd' },
        options: [
          { optionId: 'opt-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'opt-deny', name: 'Deny', kind: 'reject_once' },
        ],
      },
    });
    if (mode === 'interactive') {
      send({
        jsonrpc: '2.0',
        id: 'perm-question',
        method: 'session/request_permission',
        params: {
          sessionId: sid,
          toolCall: { toolCallId: 'interaction_1', title: 'Pick option' },
          options: [
            { optionId: 'opt-a', name: 'Option A', kind: 'allow_once' },
            { optionId: 'opt-b', name: 'Option B', kind: 'allow_once' },
          ],
        },
      });
      activePromptId = msg.id;
      return;
    }
    // 4. Execute tool call + incremental output + completion
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: sid,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'cmd-1',
          kind: 'execute',
          title: 'Run pwd',
          status: 'in_progress',
          rawInput: { CommandLine: 'pwd', Cwd: process.cwd() },
        },
      },
    });
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: sid,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'cmd-1',
          status: 'in_progress',
          rawOutput: { combinedOutput: '/workspace' },
        },
      },
    });
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: sid,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'cmd-1',
          status: 'completed',
          rawOutput: { combinedOutput: '/workspace\\n', exitCode: 0 },
        },
      },
    });
    // 5. File edit diff tool call
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: sid,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'edit-1',
          kind: 'edit',
          status: 'completed',
          content: [{ type: 'diff', path: 'README.md', oldText: 'old', newText: 'new' }],
        },
      },
    });
    // 6. Assistant message chunks
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: sid,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'All ' } },
      },
    });
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: sid,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done.' } },
      },
    });
    // Wait briefly so permission replies are logged before prompt finishes
    setTimeout(() => {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { stopReason: 'end_turn', usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 } },
      });
    }, 25);
    return;
  }
  if (msg.id === 'perm-question' && activePromptId !== null) {
    const id = activePromptId;
    activePromptId = null;
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'agy-session-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Picked.' } },
      },
    });
    send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
    return;
  }
  if (msg.method === 'session/cancel' && activePromptId !== null) {
    const id = activePromptId;
    activePromptId = null;
    send({ jsonrpc: '2.0', id, result: { stopReason: 'cancelled' } });
  }
});
`;
  writeFileSync(scriptPath, script, 'utf8');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

let root: string | undefined;
const originalAgyBin = process.env.XOPC_AGY_BIN;

afterEach(async () => {
  await disposeAllPooledExternalSessions(true);
  if (originalAgyBin === undefined) delete process.env.XOPC_AGY_BIN;
  else process.env.XOPC_AGY_BIN = originalAgyBin;
  closeXopcDatabase();
  if (root) rmSync(root, { force: true, recursive: true });
  root = undefined;
});

it('registers agy driver and runs multi-turn ACP session with resume across SQLite reopen', async () => {
  expect(getExternalAgentDriver('agy').label).toBe('Antigravity');
  root = mkdtempSync(join(tmpdir(), 'xopc-agy-turn-'));
  const dbPath = join(root, 'xopc.db');
  const rpcLog = join(root, 'rpc.jsonl');
  process.env.XOPC_AGY_BIN = createFakeAgyBinary(root, rpcLog, 'normal');

  openXopcDatabase({ path: dbPath });
  const project = new ProjectStore().create({ name: 'AGY project', workspaceRoot: root });
  const session = createConversation({ agentId: 'agy-coder', projectId: project.id }, root);
  expect(hasExternalSessionBinding(session.key)).toBe(false);

  const run = (runId: string) => Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'agy-coder',
    execution: { kind: 'agy' },
    instructions: 'Be concise.',
    runId,
    content: 'Inspect workspace',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  const firstEvents = await run('agy-run-1');
  expect(firstEvents.map(event => event.type)).toEqual([
    'user_message',
    'message_start',
    'message_update', // thought delta
    'tool_execution_start', // update_plan
    'tool_execution_end', // update_plan
    'tool_execution_start', // exec_command
    'tool_execution_update',
    'tool_execution_update',
    'tool_execution_end',
    'tool_execution_start', // apply_patch
    'tool_execution_end',
    'message_update', // "All "
    'message_update', // "done."
    'message_end',
    'turn_outcome',
  ]);
  expect(hasExternalSessionBinding(session.key)).toBe(true);

  const outcome = firstEvents.find(event => event.type === 'turn_outcome')?.outcome as {
    changeSet?: { files: Array<{ path: string; status?: string }>; added: number; removed: number };
  };
  expect(outcome?.changeSet?.files).toEqual([{ path: 'README.md', status: 'modified' }]);
  expect(outcome?.changeSet?.added).toBe(1);
  expect(outcome?.changeSet?.removed).toBe(1);

  const logged = readFileSync(rpcLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(logged.find(entry => entry.method === 'session/new')?.params?._meta).toEqual({
    antigravity: { systemPrompt: { append: 'Be concise.' } },
  });
  expect(logged.find(entry => entry.id === 'perm-1')?.result).toEqual({
    outcome: { outcome: 'selected', optionId: 'opt-once' },
  });

  // Reopen SQLite and verify follow-up uses session/resume
  closeXopcDatabase();
  openXopcDatabase({ path: dbPath });

  await run('agy-run-2');
  const loggedAfter = readFileSync(rpcLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(loggedAfter.some(entry => entry.method === 'session/resume' && entry.params?.sessionId === 'agy-session-1')).toBe(true);

  const rows = getSqliteDatabase()
    .prepare('SELECT payload_json FROM transcript_entries WHERE transcript_id = ? ORDER BY seq')
    .all(session.transcriptId!) as Array<{ payload_json: string }>;
  const payloads = rows.map(row => JSON.parse(row.payload_json));
  expect(payloads.some(p => p.role === 'assistant' && p.content?.[0]?.type === 'thinking' && p.content[0].thinking === 'Checking files')).toBe(true);
  expect(payloads.some(p => p.role === 'toolResult' && p.toolName === 'update_plan')).toBe(true);
});

it('falls back to session/load and ignores replayed notifications during load', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-agy-load-'));
  const rpcLog = join(root, 'rpc.jsonl');
  process.env.XOPC_AGY_BIN = createFakeAgyBinary(root, rpcLog, 'load_only');

  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'AGY load project', workspaceRoot: root });
  const session = createConversation({ agentId: 'agy-coder', projectId: project.id }, root);

  const run = (runId: string) => Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'agy-coder',
    execution: { kind: 'agy' },
    runId,
    content: 'Hello',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  await run('load-1');
  // Simulate cold restart/eviction so turn 2 exercises session/load replay filtering.
  await disposePooledExternalSession(session.key, true);
  const secondEvents = await run('load-2');
  const textDeltas = secondEvents
    .filter(event => event.type === 'message_update')
    .map(event => (event.assistantMessageEvent as { delta?: string })?.delta ?? '');
  expect(textDeltas.join('')).not.toContain('Replayed history');

  const logged = readFileSync(rpcLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(logged.some(entry => entry.method === 'session/load' && entry.params?.sessionId === 'agy-session-1')).toBe(true);
});

it('surfaces a clear sign-in error when agy prints an OAuth URL to stdout', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-agy-auth-'));
  const rpcLog = join(root, 'rpc.jsonl');
  process.env.XOPC_AGY_BIN = createFakeAgyBinary(root, rpcLog, 'auth_url');

  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'AGY auth project', workspaceRoot: root });
  const session = createConversation({ agentId: 'agy-coder', projectId: project.id }, root);

  const events = await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'agy-coder',
    execution: { kind: 'agy' },
    runId: 'auth-run',
    content: 'Hello',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  const errorEvent = events.find(event => event.type === 'error');
  expect(String(errorEvent?.content ?? '')).toContain('Antigravity is not signed in');
});

it('sends session/cancel on abort and settles turn as partial/aborted', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-agy-cancel-'));
  const rpcLog = join(root, 'rpc.jsonl');
  process.env.XOPC_AGY_BIN = createFakeAgyBinary(root, rpcLog, 'cancel');

  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'AGY cancel project', workspaceRoot: root });
  const session = createConversation({ agentId: 'agy-coder', projectId: project.id }, root);

  const controller = new AbortController();
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  for await (const event of runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'agy-coder',
    execution: { kind: 'agy' },
    runId: 'cancel-run',
    content: 'Long task',
    hasAttachmentsOrContext: false,
    signal: controller.signal,
  })) {
    events.push(event);
    if (event.type === 'message_update') controller.abort();
  }

  const outcome = events.find(event => event.type === 'turn_outcome')?.outcome as { status?: string; summary?: string } | undefined;
  expect(outcome?.status).toBe('partial');
  expect(outcome?.summary).toBe('aborted');

  const logged = readFileSync(rpcLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(logged.some(entry => entry.method === 'session/cancel' && entry.params?.sessionId === 'agy-session-1')).toBe(true);
});

it('probes AGY readiness, discovered models, unauthenticated state, and missing binary', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-agy-probe-'));
  const rpcLog = join(root, 'rpc.jsonl');
  const normalBin = createFakeAgyBinary(root, rpcLog, 'normal');

  const ready = await probeExternalAgentRuntime({ kind: 'agy', binaryPath: normalBin });
  expect(ready.kind).toBe('agy');
  expect(ready.status).toBe('ready');
  expect(ready.version).toBe('1.5.8');
  expect(ready.models).toEqual([
    { id: 'gemini-3-pro', label: 'Gemini 3 Pro', isDefault: true },
    { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  ]);

  const authDir = mkdtempSync(join(tmpdir(), 'xopc-agy-probe-auth-'));
  try {
    const authBin = createFakeAgyBinary(authDir, join(authDir, 'rpc.jsonl'), 'auth_url');
    const unauth = await probeExternalAgentRuntime({ kind: 'agy', binaryPath: authBin });
    expect(unauth.status).toBe('unauthenticated');
    expect(unauth.hintCommand).toBe('agy acp --login');
  } finally {
    rmSync(authDir, { force: true, recursive: true });
  }

  const missing = await probeExternalAgentRuntime({ kind: 'agy', binaryPath: join(root, 'does-not-exist') });
  expect(missing.status).toBe('not_installed');
});

it('resolves a relative AGY profile against the gateway directory for authentication and execution', () => {
  const options = { kind: 'agy', geminiDir: 'profiles/test' } as const;
  expect(resolveAgySpawnSpec(options).args).toEqual([
    'acp', '--gemini-dir', join(process.cwd(), 'profiles/test'), '--app-data-dir', 'antigravity-acp',
  ]);
  expect(resolveAgySpawnSpec({ kind: 'agy' }, { XOPC_AGY_GEMINI_DIR: 'profiles/test' }).args)
    .toEqual(resolveAgySpawnSpec(options).args);
});

it('applies execution.model via session/set_config_option when overriding AGY default model', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-agy-model-'));
  const rpcLog = join(root, 'rpc.jsonl');
  const bin = createFakeAgyBinary(root, rpcLog, 'normal');

  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'AGY model project', workspaceRoot: root });
  const session = createConversation({ agentId: 'agy-coder', projectId: project.id }, root);

  await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'agy-coder',
    execution: { kind: 'agy', binaryPath: bin, model: 'gemini-3-flash' },
    runId: 'model-override-run',
    content: 'Use flash model',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  const logged = readFileSync(rpcLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(logged.some(entry =>
    entry.method === 'session/set_config_option'
    && entry.params?.sessionId === 'agy-session-1'
    && entry.params?.configId === 'model'
    && entry.params?.value === 'gemini-3-flash',
  )).toBe(true);
});

it('bridges live Antigravity interaction questions, ask-mode approvals, and image attachments', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-agy-interactive-'));
  const rpcLog = join(root, 'rpc.jsonl');
  const bin = createFakeAgyBinary(root, rpcLog, 'interactive');

  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'AGY interactive', workspaceRoot: root });
  const session = createConversation({ agentId: 'agy-coder', projectId: project.id }, root);

  const clarifyKinds: string[] = [];
  for await (const event of runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'agy-coder',
    execution: { kind: 'agy', binaryPath: bin, permissionMode: 'ask' },
    runId: 'interactive-run',
    content: 'Inspect screenshot',
    attachments: [
      { type: 'image', name: 'ui.png', mimeType: 'image/png', data: 'data:image/png;base64,iVBORw0KGgo=' },
    ],
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  })) {
    if (event.type === 'clarify_request' && typeof event.requestId === 'string') {
      clarifyKinds.push(String(event.kind));
      if (event.kind === 'approval') {
        resolveExternalInteraction({
          id: event.requestId,
          expectedVersion: 1,
          action: 'answer',
          decision: 'approve',
        });
      } else {
        resolveExternalInteraction({
          id: event.requestId,
          expectedVersion: 1,
          action: 'answer',
          response: { choiceId: 'opt-a' },
        });
      }
    }
  }

  expect(clarifyKinds).toEqual(['approval', 'input']);
  const logged = readFileSync(rpcLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(logged.find(entry => entry.id === 'perm-1')?.result).toEqual({
    outcome: { outcome: 'selected', optionId: 'opt-once' },
  });
  expect(logged.find(entry => entry.id === 'perm-question')?.result).toEqual({
    outcome: { outcome: 'selected', optionId: 'opt-a' },
  });
  const promptReq = logged.find(entry => entry.method === 'session/prompt');
  expect(promptReq?.params?.prompt).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'text', text: 'Inspect screenshot' }),
    expect.objectContaining({ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }),
  ]));
});

it('discovers ACP thinking configOptions on probe and applies session modelOverride and thinkingLevel', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-agy-thinking-'));
  const rpcLog = join(root, 'rpc.jsonl');
  const binPath = join(root, 'fake-agy-thinking.mjs');
  writeFileSync(binPath, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const logPath = ${JSON.stringify(rpcLog)};
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  appendFileSync(logPath, JSON.stringify(msg) + '\\n');
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } });
    return;
  }
  if (msg.method === 'session/new') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        sessionId: 'agy-think-1',
        configOptions: [
          {
            id: 'model',
            category: 'model',
            type: 'select',
            currentValue: 'gemini-2.5-pro',
            options: [
              { value: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
              { value: 'gemini-3-pro', name: 'Gemini 3 Pro' },
            ],
          },
          {
            id: 'thought_level',
            category: 'thought_level',
            type: 'select',
            currentValue: 'medium',
            options: [
              { value: 'off', name: 'Off' },
              { value: 'low', name: 'Low' },
              { value: 'medium', name: 'Medium' },
              { value: 'high', name: 'High' },
            ],
          },
        ],
      },
    });
    return;
  }
  if (msg.method === 'session/set_config_option') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
    return;
  }
  if (msg.method === 'session/prompt') {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'agy-think-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OK' } },
      },
    });
    send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
  }
});
`);
  chmodSync(binPath, 0o755);

  const probe = await probeExternalAgentRuntime({ kind: 'agy', binaryPath: binPath });
  expect(probe.status).toBe('ready');
  expect(probe.models).toEqual([
    {
      id: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      isDefault: true,
      thinking: { mode: 'levels', options: ['off', 'low', 'medium', 'high'], initialValue: 'medium', supportsAdaptive: false },
      thinkingConfigId: 'thought_level',
    },
    {
      id: 'gemini-3-pro',
      label: 'Gemini 3 Pro',
      thinking: { mode: 'levels', options: ['off', 'low', 'medium', 'high'], initialValue: 'medium', supportsAdaptive: false },
      thinkingConfigId: 'thought_level',
    },
  ]);

  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'AGY Thinking', workspaceRoot: root });
  const session = createConversation({ agentId: 'agy-coder', projectId: project.id }, root);

  await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'agy-coder',
    execution: { kind: 'agy', binaryPath: binPath },
    modelOverride: 'gemini-3-pro',
    thinkingLevel: 'high',
    runId: 'think-run',
    content: 'Think carefully',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  const logged = readFileSync(rpcLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(logged.some(entry =>
    entry.method === 'session/set_config_option'
    && entry.params?.configId === 'model'
    && entry.params?.value === 'gemini-3-pro',
  )).toBe(true);
  expect(logged.some(entry =>
    entry.method === 'session/set_config_option'
    && entry.params?.configId === 'thought_level'
    && entry.params?.value === 'high',
  )).toBe(true);
});

it('steers an active Antigravity/ACP turn via cancel-and-resume on the same native session', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-agy-steer-'));
  const rpcLog = join(root, 'rpc.jsonl');
  const binPath = join(root, 'fake-agy-steer.mjs');
  writeFileSync(binPath, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const logPath = ${JSON.stringify(rpcLog)};
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
let pendingPromptId = null;
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  appendFileSync(logPath, JSON.stringify(msg) + '\\n');
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } } });
    return;
  }
  if (msg.method === 'session/new') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'agy-steer-session' } });
    return;
  }
  if (msg.method === 'session/resume') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: msg.params.sessionId } });
    return;
  }
  if (msg.method === 'session/cancel') {
    if (pendingPromptId !== null) {
      const id = pendingPromptId;
      pendingPromptId = null;
      send({ jsonrpc: '2.0', id, result: { stopReason: 'cancelled' } });
    }
    return;
  }
  if (msg.method === 'session/prompt') {
    const promptText = msg.params?.prompt?.[0]?.text ?? '';
    if (promptText.includes('Task A')) {
      pendingPromptId = msg.id;
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'agy-steer-session',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Starting A...' } },
        },
      });
      return;
    }
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'agy-steer-session',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Redirected to B.' } },
      },
    });
    send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
  }
});
`);
  chmodSync(binPath, 0o755);

  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'AGY Steer', workspaceRoot: root });
  const session = createConversation({ agentId: 'agy-coder', projectId: project.id }, root);

  let handled = false;
  let steered = false;
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  for await (const event of runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'agy-coder',
    execution: { kind: 'agy', binaryPath: binPath },
    runId: 'agy-steer-run',
    content: 'Work on Task A',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  })) {
    events.push(event);
    if (!steered && event.type === 'message_update') {
      steered = true;
      const accepted = await steerExternalTurn(session.key, 'Switch to Task B', 'agy-steer-run', {
        clientMessageId: 'agy-steer-1',
        onHandled: () => { handled = true; },
      });
      expect(accepted).toBe(true);
    }
  }

  expect(handled).toBe(true);
  const logged = readFileSync(rpcLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(logged.some(entry => entry.method === 'session/cancel' && entry.params?.sessionId === 'agy-steer-session')).toBe(true);
  expect(logged.some(entry => entry.method === 'session/resume' && entry.params?.sessionId === 'agy-steer-session')).toBe(true);
  expect(events.some(e =>
    e.type === 'user_message'
    && e.content === 'Switch to Task B'
    && (e.metadata as { steered?: boolean; clientMessageId?: string } | undefined)?.steered === true
    && (e.metadata as { clientMessageId?: string } | undefined)?.clientMessageId === 'agy-steer-1',
  )).toBe(true);
  const outcome = events.find(e => e.type === 'turn_outcome')?.outcome as { status?: string } | undefined;
  expect(outcome?.status).toBe('succeeded');
});

it('reuses a warm pooled ACP process across consecutive turns and syncs Plan mode + sourceContexts', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-agy-pool-'));
  const rpcLog = join(root, 'rpc.jsonl');
  const binPath = join(root, 'fake-agy-pool.mjs');
  writeFileSync(binPath, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const logPath = ${JSON.stringify(rpcLog)};
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  appendFileSync(logPath, JSON.stringify(msg) + '\\n');
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } } });
    return;
  }
  if (msg.method === 'session/new') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        sessionId: 'agy-warm-1',
        modes: {
          currentModeId: 'auto',
          availableModes: [
            { id: 'auto', name: 'Auto' },
            { id: 'plan', name: 'Plan' },
          ],
        },
      },
    });
    return;
  }
  if (msg.method === 'session/set_mode') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
    return;
  }
  if (msg.method === 'session/prompt') {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'agy-warm-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Warm reply' } },
      },
    });
    send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
  }
});
`);
  chmodSync(binPath, 0o755);

  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'AGY Pool', workspaceRoot: root });
  const session = createConversation({ agentId: 'agy-coder', projectId: project.id }, root);

  // Turn 1: cold start -> initialize + session/new + session/prompt
  await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'agy-coder',
    execution: { kind: 'agy', binaryPath: binPath },
    runId: 'warm-run-1',
    content: 'First turn',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));
  expect(getPooledExternalSessionCount()).toBe(1);

  // Switch to Plan mode and attach a note context for Turn 2
  setSessionInteractionPolicy(session.key, { mode: 'plan', access: 'read-only' });
  await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'agy-coder',
    execution: { kind: 'agy', binaryPath: binPath },
    runId: 'warm-run-2',
    content: 'Plan next step',
    sourceContexts: [
      {
        kind: 'note',
        sourceId: 'n-1',
        version: '1',
        title: 'Roadmap',
        text: 'Keep API backward compatible.',
      },
    ],
    hasAttachmentsOrContext: true,
    signal: new AbortController().signal,
  }));

  const logged = readFileSync(rpcLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  // Warm reuse: initialize & session/new happen ONCE; zero session/resume calls!
  expect(logged.filter(entry => entry.method === 'initialize')).toHaveLength(1);
  expect(logged.filter(entry => entry.method === 'session/new')).toHaveLength(1);
  expect(logged.filter(entry => entry.method === 'session/resume')).toHaveLength(0);
  expect(logged.filter(entry => entry.method === 'session/prompt')).toHaveLength(2);
  expect(logged.some(entry => entry.method === 'session/set_mode' && entry.params?.modeId === 'plan')).toBe(true);
  const secondPrompt = logged.filter(entry => entry.method === 'session/prompt')[1];
  expect(secondPrompt?.params?.prompt?.[0]?.text).toContain('Keep API backward compatible.');
});

it('discovers ACP available_commands_update on probe and supports session/fork when advertised', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-agy-cmd-fork-'));
  const rpcLog = join(root, 'rpc.jsonl');
  const binPath = join(root, 'fake-agy-cmd-fork.mjs');
  writeFileSync(binPath, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const logPath = ${JSON.stringify(rpcLog)};
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  appendFileSync(logPath, JSON.stringify(msg) + '\\n');
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { resume: {}, fork: {} } },
      },
    });
    return;
  }
  if (msg.method === 'session/new') {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'agy-cmd-1',
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: [
            { name: '/review', description: 'Review current diff' },
            { name: 'test-suite', description: 'Run project tests' },
          ],
        },
      },
    });
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'agy-cmd-1' } });
    return;
  }
  if (msg.method === 'session/fork') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'agy-forked-2' } });
  }
});
`);
  chmodSync(binPath, 0o755);

  const probe = await probeExternalAgentRuntime({ kind: 'agy', binaryPath: binPath });
  expect(probe.commands).toEqual([
    { name: 'review', description: 'Review current diff', source: 'command' },
    { name: 'test-suite', description: 'Run project tests', source: 'command' },
  ]);

  const driver = getExternalAgentDriver('agy');
  const forked = await driver.forkSession?.({
    conversationId: 'conv-1',
    execution: { kind: 'agy', binaryPath: binPath },
    cwd: root,
    nativeSessionId: 'agy-cmd-1',
  });
  expect(forked).toEqual({ nativeSessionId: 'agy-forked-2' });
});
