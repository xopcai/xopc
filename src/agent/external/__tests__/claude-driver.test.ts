import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { ProjectStore } from '../../../projects/project-store.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../storage/sqlite/connection.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import {
  disposeAllPooledExternalSessions,
  externalRuntimeDefaultAvatar,
  forkExternalSession,
  hasExternalSessionBinding,
  probeExternalAgentRuntime,
  renderExternalRuntimeAvatarSvg,
  resolveExternalInteraction,
  runExternalProjectTurn,
} from '../index.js';

function createFakeClaudeBinary(dir: string, logPath: string): string {
  const scriptPath = join(dir, 'fake-claude');
  const script = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const logPath = ${JSON.stringify(logPath)};
const recordLog = (entry) => appendFileSync(logPath, JSON.stringify(entry) + '\\n');

if (process.argv.includes('--version')) {
  process.stdout.write('2.1.99 (Claude Code)\\n');
  process.exit(0);
}

const argValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  return idx === -1 ? undefined : process.argv[idx + 1];
};

const isFork = process.argv.includes('--fork-session');
const resumed = argValue('--resume');
let sessionId = isFork ? 'claude-session-forked-2' : (resumed || 'claude-session-1');
let currentModel = argValue('--model') || 'claude-sonnet-4-6';
let currentPerm = argValue('--permission-mode') || 'bypassPermissions';

recordLog({ event: 'spawn', argv: process.argv.slice(2), sessionId });

const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
const pendingReverse = new Map();
let reqSeq = 0;

const askHost = (subtype, payload) => new Promise((resolve) => {
  const id = 'host-req-' + (++reqSeq);
  pendingReverse.set(id, resolve);
  send({ type: 'control_request', request_id: id, request: { subtype, ...payload } });
});

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  recordLog({ event: 'in', msg });

  if (msg.type === 'control_response') {
    const resp = msg.response;
    const resolver = pendingReverse.get(resp?.request_id);
    if (resolver) {
      pendingReverse.delete(resp.request_id);
      resolver(resp.response);
    }
    return;
  }

  if (msg.type === 'control_request') {
    const sub = msg.request?.subtype;
    if (sub === 'initialize') {
      send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: msg.request_id,
          response: {
            account: { email: 'claude@example.com', subscriptionType: 'max', tokenSource: 'claude.ai' },
            models: [
              { value: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', isDefault: true, supportedEffortLevels: ['low', 'medium', 'high'] },
              { value: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
            ],
            commands: [{ name: '/review', description: 'Review diff carefully' }],
          },
        },
      });
      return;
    }
    if (sub === 'get_usage') {
      send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: msg.request_id,
          response: {
            rate_limits_available: true,
            rate_limits: [{ utilization: 0.42, window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) + 3600 }],
          },
        },
      });
      return;
    }
    if (sub === 'set_model') {
      currentModel = msg.request?.model || currentModel;
      send({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } });
      return;
    }
    if (sub === 'set_permission_mode') {
      currentPerm = msg.request?.mode || currentPerm;
      send({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } });
      return;
    }
    send({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } });
    return;
  }

  if (msg.type === 'user') {
    send({
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      model: currentModel,
      permissionMode: currentPerm,
    });

    const content = msg.message?.content;
    const text = typeof content === 'string'
      ? content
      : (Array.isArray(content) ? content.map((b) => b.text || '').join('') : '');

    if (text.includes('ask-tool')) {
      const approval = await askHost('can_use_tool', {
        tool_name: 'Bash',
        input: { command: 'npm test', description: 'Run unit tests' },
      });
      recordLog({ event: 'approval_reply', approval });
      const toolId = 'toolu_bash_1';
      send({
        type: 'assistant',
        session_id: sessionId,
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_todo_1', name: 'TodoWrite', input: { todos: [{ content: 'Run tests', status: 'in_progress' }] } },
            { type: 'tool_use', id: toolId, name: 'Bash', input: { command: 'npm test' } },
          ],
        },
      });
      send({
        type: 'user',
        session_id: sessionId,
        message: {
          content: [{ type: 'tool_result', tool_use_id: toolId, content: 'All passed', is_error: false }],
        },
        tool_use_result: { stdout: 'All passed', stderr: '' },
      });
    }

    send({
      type: 'stream_event',
      session_id: sessionId,
      event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    });
    send({
      type: 'stream_event',
      session_id: sessionId,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Planning steps.' } },
    });
    send({
      type: 'stream_event',
      session_id: sessionId,
      event: { type: 'content_block_stop', index: 0 },
    });
    send({
      type: 'stream_event',
      session_id: sessionId,
      event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    });
    send({
      type: 'stream_event',
      session_id: sessionId,
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Reply(' + currentModel + ',' + currentPerm + '): ' + text } },
    });
    send({
      type: 'stream_event',
      session_id: sessionId,
      event: { type: 'content_block_stop', index: 1 },
    });
    send({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: sessionId,
      result: 'Reply(' + currentModel + ',' + currentPerm + '): ' + text,
      usage: { input_tokens: 120, output_tokens: 45, cache_read_input_tokens: 30, cache_creation_input_tokens: 0 },
    });
  }
});
`;
  writeFileSync(scriptPath, script, 'utf8');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

let root: string | undefined;
afterEach(async () => {
  await disposeAllPooledExternalSessions(true);
  closeXopcDatabase();
  if (root) rmSync(root, { force: true, recursive: true });
});

it('probes Claude Code account, models, commands, rateLimits and renders brand avatar', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-claude-probe-'));
  const logPath = join(root, 'claude.log');
  const bin = createFakeClaudeBinary(root, logPath);

  const probe = await probeExternalAgentRuntime({ kind: 'claude', binaryPath: bin });
  expect(probe.status).toBe('ready');
  expect(probe.version).toBe('2.1.99');
  expect(probe.account).toEqual({ label: 'claude@example.com', authMode: 'max' });
  expect(probe.models.map((m) => m.id)).toEqual(['claude-sonnet-4-6', 'claude-opus-4-6']);
  expect(probe.commands).toEqual([{ name: 'review', description: 'Review diff carefully', source: 'command' }]);
  expect(probe.rateLimits?.primary?.usedPercent).toBe(42);

  expect(externalRuntimeDefaultAvatar('claude')).toBe('xopc:runtime:claude');
  expect(renderExternalRuntimeAvatarSvg('claude')).toContain('#D97757');
});

it('streams Claude Code turns, bridges tool approvals, reuses warm pooled process, and forks via --fork-session', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-claude-turn-'));
  const logPath = join(root, 'claude.log');
  const bin = createFakeClaudeBinary(root, logPath);
  openXopcDatabase({ path: join(root, 'xopc.db') });
  initializeTestAgentCatalog({
    defaults: {
      models: { chat: { primary: 'openai/gpt-5', fallbacks: [] }, intents: {} },
      skills: { mode: 'all-enabled', exclude: [] },
      tools: {},
      runtime: {},
    },
    agents: [
      { id: 'main', enabled: true, profile: { name: 'Main' } },
      { id: 'claude-agent', enabled: true, execution: { kind: 'claude', binaryPath: bin, permissionMode: 'ask' }, profile: { name: 'Claude Code' } },
    ],
  });
  const project = new ProjectStore().create({ name: 'Claude Project', workspaceRoot: root });
  const source = createConversation({ agentId: 'claude-agent', projectId: project.id }, root);
  const forkedConv = createConversation({ agentId: 'claude-agent', projectId: project.id }, root);

  // Turn 1: approval + Bash tool + TodoWrite plan + thinking + text
  const events1: Array<{ type: string; [key: string]: unknown }> = [];
  for await (const ev of runExternalProjectTurn({
    conversationId: source.key,
    transcriptId: source.transcriptId!,
    agentId: 'claude-agent',
    execution: { kind: 'claude', binaryPath: bin, permissionMode: 'ask' },
    runId: 'claude-run-1',
    content: 'Please ask-tool now',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  })) {
    events1.push(ev);
    if (ev.type === 'clarify_request' && typeof ev.requestId === 'string') {
      resolveExternalInteraction({
        id: ev.requestId,
        expectedVersion: 1,
        action: 'answer',
        decision: 'approve',
      });
    }
  }
  expect(events1.some((e) => e.type === 'tool_execution_end' && e.toolName === 'update_plan')).toBe(true);
  expect(events1.some((e) => e.type === 'tool_execution_end' && e.toolName === 'exec_command')).toBe(true);

  // Turn 2: warm pooled process reuse with live model switch (no second spawn!)
  const events2 = await Array.fromAsync(runExternalProjectTurn({
    conversationId: source.key,
    transcriptId: source.transcriptId!,
    agentId: 'claude-agent',
    execution: { kind: 'claude', binaryPath: bin, permissionMode: 'ask' },
    modelOverride: 'claude-opus-4-6',
    runId: 'claude-run-2',
    content: 'Second turn',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));
  expect(events2.map((e) => e.type)).toContain('message_end');

  const logsBeforeFork = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const spawnsBeforeFork = logsBeforeFork.filter((e) => e.event === 'spawn');
  expect(spawnsBeforeFork).toHaveLength(1);
  expect(logsBeforeFork.some((e) => e.event === 'in' && e.msg?.request?.subtype === 'set_model' && e.msg?.request?.model === 'claude-opus-4-6')).toBe(true);

  // Fork session and verify `--resume <id> --fork-session` rotates to the new native session id
  const forked = await forkExternalSession({
    sourceConversationId: source.key,
    targetConversationId: forkedConv.key,
  });
  expect(forked).toBe(true);
  expect(hasExternalSessionBinding(forkedConv.key)).toBe(true);

  await Array.fromAsync(runExternalProjectTurn({
    conversationId: forkedConv.key,
    transcriptId: forkedConv.transcriptId!,
    agentId: 'claude-agent',
    execution: { kind: 'claude', binaryPath: bin, permissionMode: 'full_access' },
    runId: 'claude-fork-run',
    content: 'Explore branch',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  const logsAfterFork = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const forkSpawn = logsAfterFork.filter((e) => e.event === 'spawn').at(-1);
  expect(forkSpawn?.argv).toContain('--resume');
  expect(forkSpawn?.argv).toContain('claude-session-1');
  expect(forkSpawn?.argv).toContain('--fork-session');

  const bindingRow = getSqliteDatabase()
    .prepare('SELECT native_session_id FROM external_agent_session_bindings WHERE transcript_id = ?')
    .get(forkedConv.transcriptId!) as { native_session_id: string } | undefined;
  expect(bindingRow?.native_session_id).toBe('claude-session-forked-2');
});
