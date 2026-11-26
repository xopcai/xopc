import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../../storage/sqlite/connection.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { ProjectStore } from '../../../projects/project-store.js';
import {
  appendExternalTranscriptEntry,
  bindExternalSession,
  hasExternalSessionBinding,
  readExternalSessionBinding,
  runExternalProjectTurn,
} from '../index.js';
import type { CodexRecord } from '../drivers/codex/app-server.js';

const requests = vi.hoisted(() => vi.fn());
const onTurnStartHook = vi.hoisted(() => ({ fn: undefined as (() => void) | undefined }));
vi.mock('../drivers/codex/app-server.js', async importOriginal => {
  const original = await importOriginal<typeof import('../drivers/codex/app-server.js')>();
  return {
    ...original,
    CodexAppServer: class {
      constructor(_cwd: string, private readonly emit: (method: string, params: CodexRecord) => void) {}

      notify() {}
      async close() {}
      async request(method: string, params: CodexRecord) {
        requests(method, params);
        if (method === 'model/list') return { data: [{ isDefault: true, model: 'test-codex-model' }] };
        if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'native-thread' } };
        if (method === 'turn/start') {
          onTurnStartHook.fn?.();
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
afterEach(() => {
  requests.mockClear();
  onTurnStartHook.fn = undefined;
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
    runtimeKind: 'codex',
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
    approvalPolicy: 'never', sandbox: 'danger-full-access', model: 'test-codex-model',
  }));
  expect(requests).toHaveBeenCalledWith('turn/start', expect.objectContaining({
    approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' },
  }));
  closeXopcDatabase();
  openXopcDatabase({ path });

  await run('follow-up');
  expect(requests).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId: 'native-thread' }));
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
    runtimeKind: 'codex',
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
  onTurnStartHook.fn = () => {
    const db = getSqliteDatabase();
    db.prepare(`INSERT INTO transcripts (transcript_id, conversation_id, created_at, archived_at) VALUES ('next-transcript', ?, ?, NULL)`)
      .run(session.key, Date.now());
    db.prepare(`UPDATE sessions SET active_transcript_id = 'next-transcript' WHERE conversation_id = ?`).run(session.key);
  };

  const events = await Array.fromAsync(runExternalProjectTurn({
    conversationId: session.key,
    transcriptId: session.transcriptId!,
    agentId: 'codex',
    runtimeKind: 'codex',
    runId: 'reset-run',
    content: 'Hello',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  expect(events.some(event => event.type === 'turn_outcome')).toBe(true);
  expect(events.some(event => event.type === 'error')).toBe(true);
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
