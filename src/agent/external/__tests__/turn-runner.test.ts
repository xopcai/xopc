import { persistInboundAttachments } from '../../../channels/attachments/inbound-persist.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../../storage/sqlite/connection.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { ProjectStore } from '../../../projects/project-store.js';
import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { setSessionInteractionPolicy } from '../../session/interaction-policy.js';
import {
  appendExternalTranscriptEntry,
  bindExternalSession,
  compactExternalSession,
  disposeAllPooledExternalSessions,
  forkExternalSession,
  hasExternalSessionBinding,
  readExternalSessionBinding,
  resolveExternalInteraction,
  rollbackExternalSession,
  runExternalProjectTurn,
  steerExternalTurn,
} from '../index.js';
import type { CodexAppServerOptions, CodexRecord } from '../drivers/codex/app-server.js';

const requests = vi.hoisted(() => vi.fn());
const onTurnStartHook = vi.hoisted(() => ({ fn: undefined as ((ctx: {
  emit: (method: string, params: CodexRecord) => void;
  onRequest?: CodexAppServerOptions['onRequest'];
  params: CodexRecord;
}) => void) | undefined }));
const serverReplyLog = vi.hoisted(() => ({ replies: [] as CodexRecord[] }));
vi.mock('../drivers/codex/app-server.js', async importOriginal => {
  const original = await importOriginal<typeof import('../drivers/codex/app-server.js')>();
  return {
    ...original,
    CodexAppServer: class {
      private readonly onRequest?: CodexAppServerOptions['onRequest'];
      constructor(
        _cwd: string,
        private readonly emit: (method: string, params: CodexRecord) => void,
        _onFailure?: (err: Error) => void,
        options?: CodexAppServerOptions,
      ) {
        this.onRequest = options?.onRequest;
      }

      notify() {}
      async close() {}
      async request(method: string, params: CodexRecord) {
        requests(method, params);
        if (method === 'model/list') return { data: [
          { isDefault: true, model: 'test-codex-model' },
          { model: 'reasoning-required', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'max' }] },
          { model: 'reasoning-optional', supportedReasoningEfforts: [{ reasoningEffort: 'none' }, { reasoningEffort: 'medium' }] },
          { model: 'reasoning-legacy', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'xhigh' }] },
        ] };
        if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'native-thread' } };
        if (method === 'thread/fork') return { thread: { id: 'forked-thread-99' } };
        if (method === 'turn/start') {
          if (onTurnStartHook.fn) {
            onTurnStartHook.fn({ emit: this.emit, onRequest: this.onRequest, params });
            return { turn: { id: 'native-turn' } };
          }
          const scope = { threadId: 'native-thread', turnId: 'native-turn' };
          this.emit('item/agentMessage/delta', { ...scope, turnId: 'previous-turn', itemId: 'previous-reply', delta: 'Old text.' });
          const command = { type: 'commandExecution', id: 'command-1', command: 'pwd', cwd: params.cwd };
          this.emit('item/started', { ...scope, item: command });
          this.emit('item/started', { ...scope, item: command });
          this.emit('item/commandExecution/outputDelta', { ...scope, itemId: command.id, delta: 'project' });
          this.emit('item/completed', { ...scope, item: { ...command, exitCode: 0 } });
          this.emit('item/agentMessage/delta', { ...scope, itemId: 'reply-1', delta: 'Done.' });
          const reply = { type: 'agentMessage', id: 'reply-1', text: 'Done.' };
          this.emit('item/completed', { ...scope, item: reply });
          this.emit('item/completed', { ...scope, item: reply });
          this.emit('turn/completed', { ...scope, turn: { id: 'native-turn', status: 'completed' } });
          return { turn: { id: 'native-turn' } };
        }
        return {};
      }
    },
  };
});

let root: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await disposeAllPooledExternalSessions(true);
  requests.mockClear();
  onTurnStartHook.fn = undefined;
  serverReplyLog.replies = [];
  closeXopcDatabase();
  if (root) rmSync(root, { force: true, recursive: true });
});

it('records native items once and resumes the same external session after reopening SQLite', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-external-turn-'));
  const path = join(root, 'xopc.db');
  openXopcDatabase({ path });
  const project = new ProjectStore().create({ name: 'Codex project', workspaceRoot: root });
  const session = createConversation({ agentId: 'codex', projectId: project.id }, root);
  expect(hasExternalSessionBinding(session.key)).toBe(false);
  const run = (runId: string) => Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'codex',
    execution: { kind: 'codex' },
    runId,
    content: 'Show the working directory',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  expect((await run('first')).map(event => event.type)).toEqual([
    'user_message', 'message_start', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
    'message_update', 'message_end', 'turn_outcome',
  ]);
  expect(hasExternalSessionBinding(session.key)).toBe(true);
  expect(requests).toHaveBeenCalledWith('thread/start', expect.objectContaining({
    approvalPolicy: 'never', sandbox: 'workspace-write', model: 'test-codex-model',
  }));
  expect(requests).toHaveBeenCalledWith('turn/start', expect.objectContaining({
    approvalPolicy: 'never', sandboxPolicy: {
      type: 'workspaceWrite', writableRoots: [expect.any(String)], networkAccess: false,
      excludeTmpdirEnvVar: true, excludeSlashTmp: true,
    },
  }));
  closeXopcDatabase();
  openXopcDatabase({ path });

  await run('follow-up');
  expect(requests).toHaveBeenCalledWith('thread/resume', expect.objectContaining({
    threadId: 'native-thread', approvalPolicy: 'never', sandbox: 'workspace-write',
  }));
  const rows = getSqliteDatabase().prepare('SELECT role FROM transcript_entries WHERE transcript_id = ? ORDER BY seq').all(session.transcriptId!);
  expect(rows.map(row => row.role)).toEqual([
    'user', 'assistant', 'toolResult', 'assistant', null,
    'user', 'assistant', 'toolResult', 'assistant', null,
  ]);
});

it('does not write orphaned outcome rows if binding validation fails before user persistence', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-external-mismatch-'));
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'Codex project', workspaceRoot: root });
  const session = createConversation({ agentId: 'codex', projectId: project.id }, root);
  getSqliteDatabase().prepare(`
    INSERT INTO external_agent_session_bindings (
      transcript_id, runtime_kind, agent_id, cwd, native_session_id, last_input_entry_id, updated_at
    ) VALUES (?, 'codex', 'other-agent', ?, 'bound-thread', NULL, 0)
  `).run(session.transcriptId!, root);

  const events = await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'codex',
    execution: { kind: 'codex' },
    runId: 'mismatch-run',
    content: 'Hello',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  expect(events.map(event => event.type)).toEqual(['turn_outcome', 'error']);
  const rows = getSqliteDatabase().prepare('SELECT role FROM transcript_entries WHERE transcript_id = ?').all(session.transcriptId!);
  expect(rows).toEqual([]);
});

it('finishes cleanly without crashing if the active transcript changes mid-turn', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-external-reset-'));
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'Codex project', workspaceRoot: root });
  const session = createConversation({ agentId: 'codex', projectId: project.id }, root);
  onTurnStartHook.fn = ({ emit, params }) => {
    const db = getSqliteDatabase();
    db.prepare(`INSERT INTO transcripts (transcript_id, conversation_id, created_at, archived_at) VALUES ('next-transcript', ?, ?, NULL)`)
      .run(session.key, Date.now());
    db.prepare(`UPDATE sessions SET active_transcript_id = 'next-transcript' WHERE conversation_id = ?`).run(session.key);
    const scope = { threadId: 'native-thread', turnId: 'native-turn' };
    const command = { type: 'commandExecution', id: 'command-1', command: 'pwd', cwd: params.cwd };
    emit('item/started', { ...scope, item: command });
    emit('turn/completed', { ...scope, turn: { id: 'native-turn', status: 'completed' } });
  };

  const events = await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'codex',
    execution: { kind: 'codex' },
    runId: 'reset-run',
    content: 'Hello',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  expect(events.some(event => event.type === 'turn_outcome')).toBe(true);
  expect(events.some(event => event.type === 'error')).toBe(true);
});

it('uses explicit execution.model directly without querying model/list', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-external-model-'));
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'Codex custom model', workspaceRoot: root });
  const session = createConversation({ agentId: 'codex', projectId: project.id }, root);

  await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'codex',
    execution: { kind: 'codex', model: 'gpt-5.3-codex' },
    runId: 'custom-model-run',
    content: 'Hello',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  expect(requests).not.toHaveBeenCalledWith('model/list', expect.anything());
  expect(requests).toHaveBeenCalledWith('thread/start', expect.objectContaining({
    model: 'gpt-5.3-codex',
  }));
});

it('persists resume cursor and supports controlled native session rotation', () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-external-rotation-'));
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const session = createConversation({ agentId: 'codex' }, root);
  const identity = {
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    runtimeKind: 'codex' as const,
    agentId: 'codex',
    cwd: root,
  };
  expect(appendExternalTranscriptEntry(identity, 'entry-1', {
    role: 'user',
    content: 'hi',
    timestamp: Date.now(),
  })).toBe(true);

  bindExternalSession(identity, {
    nativeSessionId: 'native-1',
    inputEntryId: 'entry-1',
    resumeCursor: 'cursor-1',
    metadata: { mode: 'full' },
  });
  expect(readExternalSessionBinding(identity)).toEqual({
    transcriptId: session.transcriptId!,
    runtimeKind: 'codex',
    agentId: 'codex',
    cwd: root,
    nativeSessionId: 'native-1',
    resumeCursor: 'cursor-1',
    metadata: { mode: 'full' },
  });

  expect(() => bindExternalSession(identity, {
    nativeSessionId: 'native-2',
    inputEntryId: 'entry-1',
  })).toThrow('changed unexpectedly');

  bindExternalSession(identity, {
    nativeSessionId: 'native-2',
    inputEntryId: 'entry-1',
    resumeCursor: 'cursor-2',
    allowSessionRotation: true,
  });
  expect(readExternalSessionBinding(identity)?.nativeSessionId).toBe('native-2');
  expect(readExternalSessionBinding(identity)?.resumeCursor).toBe('cursor-2');
});

it('persists Codex reasoning, plans, token usage, unwrapped commands, turn changeSet/evidence, live approvals, and attachments', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-external-rich-'));
  vi.stubEnv('XOPC_STATE_DIR', root);
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'Codex rich', workspaceRoot: root });
  const session = createConversation({ agentId: 'codex', projectId: project.id }, root);

  const bytes = 'iVBORw0KGgo=';
  const attachments = await persistInboundAttachments([
    { type: 'image', name: 'shot.png', mimeType: 'image/png', data: bytes },
  ]);
  let stagedImage: string | undefined;
  let stagedBytes: string | undefined;
  onTurnStartHook.fn = ({ emit, onRequest, params }) => {
    const image = (params.input as Array<{ type: string; path?: string }>).find(item => item.type === 'localImage');
    stagedImage = image?.path;
    if (stagedImage) stagedBytes = readFileSync(stagedImage).toString('base64');
    const scope = { threadId: 'native-thread', turnId: 'native-turn' };
    void (async () => {
      emit('item/reasoning/summaryTextDelta', { ...scope, itemId: 'reason-1', delta: 'Inspecting workspace' });
      emit('item/completed', { ...scope, item: { type: 'reasoning', id: 'reason-1', summary: ['Inspecting workspace'] } });
      emit('turn/plan/updated', {
        ...scope,
        explanation: 'Fix and test',
        plan: [
          { step: 'Edit src/app.ts', status: 'inProgress' },
          { step: 'Run vitest', status: 'pending' },
        ],
      });
      if (onRequest) {
        const approval = await onRequest('item/commandExecution/requestApproval', {
          command: '/bin/zsh -lc "pnpm vitest run"',
          cwd: params.cwd,
        });
        serverReplyLog.replies.push(approval);
      }
      const cmd = { type: 'commandExecution', id: 'cmd-test', command: '/bin/zsh -lc "pnpm vitest run"', cwd: params.cwd };
      emit('item/started', { ...scope, item: cmd });
      emit('item/completed', { ...scope, item: { ...cmd, exitCode: 0, durationMs: 420, aggregatedOutput: 'PASS' } });

      const patch = {
        type: 'fileChange',
        id: 'patch-1',
        changes: [
          { path: join(String(params.cwd), 'src/app.ts'), kind: { type: 'update' }, diff: '--- src/app.ts\n+++ src/app.ts\n-old\n+new\n+more' },
        ],
      };
      emit('item/started', { ...scope, item: patch });
      emit('item/completed', { ...scope, item: { ...patch, status: 'completed' } });

      emit('thread/tokenUsage/updated', {
        threadId: 'native-thread',
        tokenUsage: { total: { inputTokens: 500, cachedInputTokens: 100, outputTokens: 120, totalTokens: 620 } },
      });
      emit('item/agentMessage/delta', { ...scope, itemId: 'msg-1', delta: 'All green.' });
      emit('item/completed', { ...scope, item: { type: 'agentMessage', id: 'msg-1', text: 'All green.' } });
      emit('turn/completed', { ...scope, turn: { id: 'native-turn', status: 'completed' } });
    })();
  };

  const events: Array<{ type: string; [key: string]: unknown }> = [];
  for await (const event of runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'codex',
    execution: { kind: 'codex', permissionMode: 'ask' },
    runId: 'rich-run',
    content: 'Fix the bug',
    attachments,
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  })) {
    events.push(event);
    if (event.type === 'clarify_request' && typeof event.requestId === 'string') {
      resolveExternalInteraction({
        id: event.requestId,
        expectedVersion: 1,
        action: 'answer',
        decision: 'approve',
      });
    }
  }

  expect(stagedBytes).toBe(bytes);
  expect(existsSync(stagedImage!)).toBe(false);
  expect(serverReplyLog.replies).toEqual([{ decision: 'accept' }]);
  expect(requests).toHaveBeenCalledWith('turn/start', expect.objectContaining({
    approvalPolicy: 'on-request',
    sandboxPolicy: expect.objectContaining({ type: 'workspaceWrite' }),
    input: expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'Fix the bug' }),
      expect.objectContaining({ type: 'localImage' }),
    ]),
  }));

  const outcome = events.find((e) => e.type === 'turn_outcome')?.outcome as {
    changeSet?: { files: Array<{ path: string; status?: string }>; added: number; removed: number };
    evidence?: Array<{ label: string; status: string }>;
  };
  expect(outcome?.changeSet?.files).toEqual([{ path: 'src/app.ts', status: 'modified' }]);
  expect(outcome?.changeSet?.added).toBe(2);
  expect(outcome?.changeSet?.removed).toBe(1);
  expect(outcome?.evidence).toEqual([
    expect.objectContaining({ label: 'pnpm vitest run', status: 'passed' }),
  ]);

  const rows = getSqliteDatabase()
    .prepare('SELECT payload_json FROM transcript_entries WHERE transcript_id = ? ORDER BY seq')
    .all(session.transcriptId!) as Array<{ payload_json: string }>;
  const payloads = rows.map((r) => JSON.parse(r.payload_json));
  expect(payloads.some((p) => p.role === 'assistant' && p.content?.[0]?.type === 'thinking' && p.content[0].thinking === 'Inspecting workspace')).toBe(true);
  expect(payloads.some((p) => p.role === 'toolResult' && p.toolName === 'update_plan')).toBe(true);
  expect(payloads.some((p) => p.role === 'assistant' && p.content?.[0]?.type === 'text' && p.usage?.input === 500)).toBe(true);
});

it.each([
  ['reasoning-required', 'off', undefined],
  ['reasoning-required', 'max', 'max'],
  ['reasoning-legacy', 'max', 'xhigh'],
  ['reasoning-optional', 'off', 'none'],
])('uses advertised Codex reasoning levels for %s with %s', async (model, thinkingLevel, expectedEffort) => {
  root = mkdtempSync(join(tmpdir(), 'xopc-codex-model-effort-'));
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'Codex model effort', workspaceRoot: root });
  const session = createConversation({ agentId: 'codex', projectId: project.id }, root);
  await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key, transcriptId: session.transcriptId!, agentId: 'codex',
    execution: { kind: 'codex', model }, thinkingLevel, runId: 'model-effort',
    content: 'Review the model effort', hasAttachmentsOrContext: false, signal: new AbortController().signal,
  }));
  const turn = requests.mock.calls.find(([method]) => method === 'turn/start')?.[1];
  expect(turn?.model).toBe(model);
  expect(turn?.effort).toBe(expectedEffort);
});

it('forwards per-session modelOverride, thinkingLevel effort, and Codex thread/name/updated title sync', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-codex-model-title-'));
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'Codex Title', workspaceRoot: root });
  const session = createConversation({ agentId: 'codex', projectId: project.id }, root);

  onTurnStartHook.fn = ({ emit }) => {
    const scope = { threadId: 'native-thread', turnId: 'native-turn' };
    queueMicrotask(() => {
      emit('thread/name/updated', { threadId: 'native-thread', threadName: 'Refactor auth flow' });
      emit('item/agentMessage/delta', { ...scope, itemId: 'msg-1', delta: 'Done.' });
      emit('item/completed', { ...scope, item: { id: 'msg-1', type: 'agentMessage', text: 'Done.' } });
      emit('turn/completed', { ...scope, turn: { id: 'native-turn', status: 'completed' } });
    });
  };

  const receivedTitles: string[] = [];
  await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'codex',
    execution: { kind: 'codex', model: 'gpt-5.3-codex' },
    modelOverride: 'gpt-5.4-codex',
    thinkingLevel: 'high',
    onTitleUpdated: (title) => receivedTitles.push(title),
    runId: 'title-run',
    content: 'Please refactor the auth flow',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  expect(receivedTitles).toEqual(['Refactor auth flow']);
  expect(requests).toHaveBeenCalledWith('thread/start', expect.objectContaining({
    model: 'gpt-5.4-codex',
  }));
  expect(requests).toHaveBeenCalledWith('turn/start', expect.objectContaining({
    model: 'gpt-5.4-codex',
    effort: 'high',
  }));
});

it('delivers mid-turn steering to Codex via native turn/steer and persists steered user row', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-codex-steer-'));
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'Codex Steer', workspaceRoot: root });
  const session = createConversation({ agentId: 'codex', projectId: project.id }, root);

  let finishTurn: (() => void) | undefined;
  onTurnStartHook.fn = ({ emit }) => {
    const scope = { threadId: 'native-thread', turnId: 'native-turn' };
    queueMicrotask(() => {
      emit('item/agentMessage/delta', { ...scope, itemId: 'msg-1', delta: 'Working on A...' });
    });
    finishTurn = () => {
      emit('item/completed', { ...scope, item: { id: 'msg-1', type: 'agentMessage', text: 'Working on A...' } });
      emit('item/agentMessage/delta', { ...scope, itemId: 'msg-2', delta: 'Switched to B.' });
      emit('item/completed', { ...scope, item: { id: 'msg-2', type: 'agentMessage', text: 'Switched to B.' } });
      emit('turn/completed', { ...scope, turn: { id: 'native-turn', status: 'completed' } });
    };
  };

  let handled = false;
  let steered = false;
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  for await (const event of runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'codex',
    execution: { kind: 'codex' },
    runId: 'steer-run',
    content: 'Work on task A',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  })) {
    events.push(event);
    if (!steered && event.type === 'message_update') {
      steered = true;
      const accepted = await steerExternalTurn(session.key, 'Actually focus on task B', 'steer-run', {
        clientMessageId: 'steer-msg-1',
        onHandled: () => { handled = true; },
      });
      expect(accepted).toBe(true);
      finishTurn?.();
    }
  }

  expect(handled).toBe(true);
  expect(requests).toHaveBeenCalledWith('turn/steer', expect.objectContaining({
    threadId: 'native-thread',
    expectedTurnId: 'native-turn',
    clientUserMessageId: 'steer-msg-1',
    input: [expect.objectContaining({ type: 'text', text: 'Actually focus on task B' })],
  }));
  expect(events.some((e) =>
    e.type === 'user_message'
    && e.content === 'Actually focus on task B'
    && (e.metadata as { steered?: boolean; clientMessageId?: string } | undefined)?.steered === true
    && (e.metadata as { clientMessageId?: string } | undefined)?.clientMessageId === 'steer-msg-1',
  )).toBe(true);

  const rows = getSqliteDatabase()
    .prepare('SELECT payload_json FROM transcript_entries WHERE transcript_id = ? ORDER BY seq')
    .all(session.transcriptId!) as Array<{ payload_json: string }>;
  const payloads = rows.map((r) => JSON.parse(r.payload_json));
  expect(payloads.some((p) =>
    p.role === 'user'
    && p.content === 'Actually focus on task B'
    && p.metadata?.steered === true
    && p.metadata?.clientMessageId === 'steer-msg-1',
  )).toBe(true);
});

it('injects xopc sourceContexts (@note/@file) and enforces Plan mode read-only sandbox for Codex', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-codex-context-plan-'));
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'Codex Context', workspaceRoot: root });
  const session = createConversation({ agentId: 'codex', projectId: project.id }, root);
  setSessionInteractionPolicy(session.key, { mode: 'plan', access: 'read-only' });

  await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'codex',
    execution: { kind: 'codex' },
    runId: 'ctx-plan-run',
    content: 'Review the architecture note and plan migration',
    sourceContexts: [
      {
        refId: 'note-ref-1',
        kind: 'note',
        sourceId: 'note-123',
        version: 'v1',
        title: 'Architecture Spec',
        text: 'Use SQLite WAL mode for all local persistence.',
      },
    ],
    hasAttachmentsOrContext: true,
    signal: new AbortController().signal,
  }));

  expect(requests).toHaveBeenCalledWith('turn/start', expect.objectContaining({
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'readOnly' },
    input: [
      expect.objectContaining({
        type: 'text',
        text: expect.stringMatching(/<plan_mode>[\s\S]*<source_contexts>[\s\S]*Use SQLite WAL mode/),
      }),
    ],
  }));

  const rows = getSqliteDatabase()
    .prepare('SELECT payload_json FROM transcript_entries WHERE transcript_id = ? ORDER BY seq')
    .all(session.transcriptId!) as Array<{ payload_json: string }>;
  const userRow = rows.map((r) => JSON.parse(r.payload_json)).find((p) => p.role === 'user');
  expect(userRow?.content).toBe('Review the architecture note and plan migration');
  expect(userRow?.metadata?.sourceContexts).toEqual([
    expect.objectContaining({ kind: 'note', sourceId: 'note-123', title: 'Architecture Spec' }),
  ]);
});

it('forwards Codex serviceTierOverride and supports native thread/compact/start and thread/fork', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-codex-control-'));
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
      { id: 'codex-ctl', enabled: true, execution: { kind: 'codex' }, profile: { name: 'Codex' } },
    ],
  });
  const project = new ProjectStore().create({ name: 'Codex Control', workspaceRoot: root });
  const source = createConversation({ agentId: 'codex-ctl', projectId: project.id }, root);
  const target = createConversation({ agentId: 'codex-ctl', projectId: project.id }, root);

  await Array.fromAsync(runExternalProjectTurn({
    conversationId: source.key,
    transcriptId: source.transcriptId!,
    agentId: 'codex-ctl',
    execution: { kind: 'codex' },
    serviceTierOverride: 'priority',
    runId: 'tier-run',
    content: 'Fast check',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  expect(requests).toHaveBeenCalledWith('turn/start', expect.objectContaining({
    serviceTier: 'priority',
  }));

  const compacted = await compactExternalSession(source.key);
  expect(compacted.compacted).toBe(true);
  expect(requests).toHaveBeenCalledWith('thread/compact/start', { threadId: 'native-thread' });

  const forked = await forkExternalSession({
    sourceConversationId: source.key,
    targetConversationId: target.key,
  });
  expect(forked).toBe(true);
  expect(requests).toHaveBeenCalledWith('thread/fork', expect.objectContaining({ threadId: 'native-thread' }));
  expect(hasExternalSessionBinding(target.key)).toBe(true);

  const rolledBack = await rollbackExternalSession(source.key, 1);
  expect(rolledBack).toBe(true);
  expect(requests).toHaveBeenCalledWith('thread/rollback', { threadId: 'native-thread', numTurns: 1 });
});

it('bridges Codex mcpServer/elicitation/request (form + url) through unified external interactions', async () => {
  root = mkdtempSync(join(tmpdir(), 'xopc-codex-elicit-'));
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const project = new ProjectStore().create({ name: 'Codex Elicit', workspaceRoot: root });
  const session = createConversation({ agentId: 'codex-elicit', projectId: project.id }, root);

  onTurnStartHook.fn = ({ emit, onRequest }) => {
    const scope = { threadId: 'native-thread', turnId: 'native-turn' };
    void (async () => {
      const formRes = await onRequest?.('mcpServer/elicitation/request', {
        threadId: 'native-thread',
        turnId: 'native-turn',
        serverName: 'github',
        mode: 'form',
        message: 'Configure deployment target',
        requestedSchema: {
          type: 'object',
          properties: {
            environment: { type: 'string', title: 'Environment', enum: ['staging', 'prod'] },
            dryRun: { type: 'boolean', title: 'Dry run?' },
          },
        },
        _meta: null,
      });
      if (formRes) serverReplyLog.replies.push(formRes);

      const urlRes = await onRequest?.('mcpServer/elicitation/request', {
        threadId: 'native-thread',
        turnId: 'native-turn',
        serverName: 'linear',
        mode: 'url',
        message: 'Authorize Linear access',
        url: 'https://linear.app/oauth/authorize?client_id=test',
        elicitationId: 'elicit-1',
        _meta: null,
      });
      if (urlRes) serverReplyLog.replies.push(urlRes);

      emit('item/agentMessage/delta', { ...scope, itemId: 'elicit-reply', delta: 'Elicitations completed.' });
      emit('item/completed', { ...scope, item: { type: 'agentMessage', id: 'elicit-reply', text: 'Elicitations completed.' } });
      emit('turn/completed', { ...scope, turn: { id: 'native-turn', status: 'completed' } });
    })();
  };

  const events: Array<{ type: string; [key: string]: unknown }> = [];
  for await (const ev of runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'codex-elicit',
    execution: { kind: 'codex' },
    runId: 'elicit-run',
    content: 'Deploy with MCP',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  })) {
    events.push(ev);
    if (ev.type === 'clarify_request' && typeof ev.requestId === 'string') {
      const q = String(ev.question ?? '');
      if (q.includes('Environment')) {
        resolveExternalInteraction({
          id: ev.requestId,
          expectedVersion: 1,
          action: 'answer',
          response: { choiceId: 'staging', text: 'staging' },
        });
      } else if (q.includes('Dry run')) {
        resolveExternalInteraction({
          id: ev.requestId,
          expectedVersion: 1,
          action: 'answer',
          response: { choiceId: 'true', text: 'true' },
        });
      } else {
        resolveExternalInteraction({
          id: ev.requestId,
          expectedVersion: 1,
          action: 'answer',
          decision: 'approve',
        });
      }
    }
  }

  expect(serverReplyLog.replies).toEqual([
    { action: 'accept', content: { environment: 'staging', dryRun: true }, _meta: null },
    { action: 'accept', content: null, _meta: null },
  ]);
  expect(events.some((e) => e.type === 'message_end')).toBe(true);
});
