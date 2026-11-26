import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { ProjectStore } from '../../../projects/project-store.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../storage/sqlite/connection.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import {
  getExternalAgentDriver,
  hasExternalSessionBinding,
  runExternalProjectTurn,
} from '../index.js';

function createFakeAgyBinary(dir: string, logFile: string, mode: 'normal' | 'load_only' | 'auth_url' | 'cancel'): string {
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
        configOptions: [{ id: 'model', type: 'select', currentValue: 'gemini-3-pro' }],
      },
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
    // 1. Thought chunk
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: sid,
        update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Checking files' } },
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
    // 3. Permission request for shell command + interaction question
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
    send({
      jsonrpc: '2.0',
      id: 'perm-question',
      method: 'session/request_permission',
      params: {
        sessionId: sid,
        toolCall: { toolCallId: 'interaction_1', title: 'Pick option' },
        options: [{ optionId: 'opt-a', name: 'A', kind: 'allow_once' }],
      },
    });
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

afterEach(() => {
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
    runtimeKind: 'agy',
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

  const logged = readFileSync(rpcLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(logged.find(entry => entry.method === 'session/new')?.params?._meta).toEqual({
    antigravity: { systemPrompt: { append: 'Be concise.' } },
  });
  expect(logged.find(entry => entry.id === 'perm-1')?.result).toEqual({
    outcome: { outcome: 'selected', optionId: 'opt-once' },
  });
  expect(logged.find(entry => entry.id === 'perm-question')?.result).toEqual({
    outcome: { outcome: 'cancelled' },
  });

  // Reopen SQLite and verify follow-up uses session/resume
  closeXopcDatabase();
  openXopcDatabase({ path: dbPath });

  await run('agy-run-2');
  const loggedAfter = readFileSync(rpcLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(loggedAfter.some(entry => entry.method === 'session/resume' && entry.params?.sessionId === 'agy-session-1')).toBe(true);

  const rows = getSqliteDatabase()
    .prepare('SELECT role FROM transcript_entries WHERE transcript_id = ? ORDER BY seq')
    .all(session.transcriptId!);
  // Per turn: user, toolCall(cmd), toolResult(cmd), toolCall(edit), toolResult(edit), assistant(text), turn_outcome
  expect(rows).toHaveLength(14);
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
    runtimeKind: 'agy',
    runId,
    content: 'Hello',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  await run('load-1');
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
    runtimeKind: 'agy',
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
    runtimeKind: 'agy',
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
