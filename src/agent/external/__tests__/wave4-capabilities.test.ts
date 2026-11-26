import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import type { Config } from '../../../config/schema.js';
import { ProjectStore } from '../../../projects/project-store.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../storage/sqlite/connection.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import {
  approvalSignatureForRequest,
  captureTurnCheckpoint,
  checkinPooledExternalSession,
  checkoutPooledExternalSession,
  clearExternalSessionApprovals,
  computeTurnCheckpointDiff,
  disposeAllPooledExternalSessions,
  hasTurnCheckpoint,
  isDangerousExternalCommand,
  projectMcpServersForAcp,
  projectMcpServersForClaude,
  projectMcpServersForCodex,
  resolveExternalContextWindow,
  resolveExternalInteraction,
  resolveExternalMcpServers,
  restoreTurnCheckpoint,
  runExternalDirectTurn,
  waitForExternalInteraction,
} from '../index.js';

let tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await disposeAllPooledExternalSessions(true);
  closeXopcDatabase();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

it('captures non-invasive per-turn Git checkpoints, computes accurate diffs, and restores files without touching HEAD', async () => {
  const repo = makeTempDir('xopc-ckpt-repo-');
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    }).trim();

  git(['init']);
  writeFileSync(join(repo, 'app.ts'), 'export const value = 1;\n', 'utf8');
  git(['add', 'app.ts']);
  git(['commit', '-m', 'init']);
  const headBefore = git(['rev-parse', 'HEAD']);

  const before = await captureTurnCheckpoint({
    cwd: repo,
    conversationId: 'conv-ckpt',
    turnId: 'turn-1',
    stage: 'before',
  });
  expect(before?.treeSha).toBeTruthy();

  // Simulate an external runtime modifying a tracked file and creating a brand-new untracked file.
  writeFileSync(join(repo, 'app.ts'), 'export const value = 2;\nexport const extra = true;\n', 'utf8');
  writeFileSync(join(repo, 'notes.md'), '# New file\n', 'utf8');

  const after = await captureTurnCheckpoint({
    cwd: repo,
    conversationId: 'conv-ckpt',
    turnId: 'turn-1',
    stage: 'after',
  });
  expect(after?.treeSha).toBeTruthy();
  expect(git(['rev-parse', 'HEAD'])).toBe(headBefore);
  expect(git(['diff', '--cached', '--name-only'])).toBe('');

  const status = await hasTurnCheckpoint({ cwd: repo, conversationId: 'conv-ckpt', turnId: 'turn-1' });
  expect(status).toEqual({ hasBefore: true, hasAfter: true });

  const diff = await computeTurnCheckpointDiff({ cwd: repo, conversationId: 'conv-ckpt', turnId: 'turn-1' });
  expect(diff?.files).toEqual(expect.arrayContaining([
    { path: 'app.ts', status: 'modified' },
    { path: 'notes.md', status: 'added' },
  ]));
  expect(diff?.added).toBeGreaterThanOrEqual(3);
  expect(diff?.removed).toBe(1);
  expect(diff?.diff).toContain('export const value = 2;');

  const restored = await restoreTurnCheckpoint({
    cwd: repo,
    conversationId: 'conv-ckpt',
    turnId: 'turn-1',
    stage: 'before',
  });
  expect(restored).toEqual({ restored: true, filesChanged: 2, stage: 'before' });
  expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('export const value = 1;\n');
  expect(existsSync(join(repo, 'notes.md'))).toBe(false);
  expect(git(['rev-parse', 'HEAD'])).toBe(headBefore);
});

it('projects enabled xopc MCP servers cleanly to Codex, ACP, and Claude Code formats', () => {
  const workspaceDir = makeTempDir('xopc-mcp-proj-');
  const fakeCfg = {
    mcp: {
      servers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', workspaceDir],
          env: { LOG_LEVEL: 'info' },
        },
        linear: {
          url: 'https://mcp.linear.app/sse',
          type: 'sse',
          headers: { Authorization: 'Bearer token' },
        },
        disabledOne: {
          command: 'echo',
          args: ['skip'],
          enabled: false,
        },
      },
    },
  } as unknown as Config;

  const specs = resolveExternalMcpServers({ workspaceDir, cfg: fakeCfg });
  expect(specs).toHaveLength(2);

  const codex = projectMcpServersForCodex(specs);
  expect(codex?.filesystem).toEqual({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', workspaceDir],
    env: { LOG_LEVEL: 'info' },
  });
  expect(codex?.linear).toEqual({
    url: 'https://mcp.linear.app/sse',
    http_headers: { Authorization: 'Bearer token' },
  });

  const acp = projectMcpServersForAcp(specs);
  expect(acp).toEqual([
    {
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', workspaceDir],
      env: [{ name: 'LOG_LEVEL', value: 'info' }],
    },
    {
      type: 'sse',
      name: 'linear',
      url: 'https://mcp.linear.app/sse',
      headers: [{ name: 'Authorization', value: 'Bearer token' }],
    },
  ]);

  const claude = projectMcpServersForClaude(specs);
  expect(claude?.filesystem).toEqual({
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', workspaceDir],
    env: { LOG_LEVEL: 'info' },
  });
  expect(claude?.linear).toEqual({
    type: 'sse',
    url: 'https://mcp.linear.app/sse',
    headers: { Authorization: 'Bearer token' },
  });
});

it('remembers session-scoped approvals while never auto-approving dangerous commands', async () => {
  const convId = 'conv-approve-mem';
  const transcriptId = 'tr-1';
  clearExternalSessionApprovals(convId);

  expect(isDangerousExternalCommand('rm -rf /')).toBe(true);
  expect(isDangerousExternalCommand('git push --force origin main')).toBe(true);
  expect(isDangerousExternalCommand('pnpm test')).toBe(false);
  expect(approvalSignatureForRequest({ kind: 'approval', question: 'git status', actionKind: 'command' }))
    .toBe('command:git:status');
  expect(approvalSignatureForRequest({ kind: 'approval', question: 'git push --force', actionKind: 'command' }))
    .toBeNull();

  const emitted: Array<Record<string, unknown>> = [];
  const signal = new AbortController().signal;

  // First prompt: user approves for session.
  const firstPromise = waitForExternalInteraction({
    conversationId: convId,
    transcriptId,
    runId: 'run-1',
    request: { kind: 'approval', question: 'pnpm test', actionKind: 'command' },
    signal,
    emitClarifyEvent: (ev) => emitted.push(ev),
  });
  expect(emitted).toHaveLength(1);
  resolveExternalInteraction({
    id: String(emitted[0]!.requestId),
    expectedVersion: 1,
    action: 'answer',
    decision: 'approve',
    response: { choiceId: 'approve_session' },
  });
  expect(await firstPromise).toEqual({ kind: 'approval', decision: 'approve' });

  // Second identical command scope auto-approves immediately without emitting a prompt!
  const second = await waitForExternalInteraction({
    conversationId: convId,
    transcriptId,
    runId: 'run-1',
    request: { kind: 'approval', question: 'pnpm test --watch=false', actionKind: 'command' },
    signal,
    emitClarifyEvent: (ev) => emitted.push(ev),
  });
  expect(second).toEqual({ kind: 'approval', decision: 'approve' });
  expect(emitted).toHaveLength(1);

  // Dangerous command still emits a prompt with warning target.
  const dangerPromise = waitForExternalInteraction({
    conversationId: convId,
    transcriptId,
    runId: 'run-1',
    request: { kind: 'approval', question: 'git push --force', actionKind: 'command' },
    signal,
    emitClarifyEvent: (ev) => emitted.push(ev),
  });
  expect(emitted).toHaveLength(2);
  resolveExternalInteraction({
    id: String(emitted[1]!.requestId),
    expectedVersion: 1,
    action: 'answer',
    decision: 'deny',
  });
  expect(await dangerPromise).toEqual({ kind: 'approval', decision: 'deny' });
  clearExternalSessionApprovals(convId);
});

it('evicts pooled external runtime processes when the host CLI binary is upgraded on disk', async () => {
  const dir = makeTempDir('xopc-pool-bin-');
  const binPath = join(dir, 'cli-bin');
  writeFileSync(binPath, '#!/bin/sh\necho v1\n', 'utf8');
  chmodSync(binPath, 0o755);

  const dispose = vi.fn(async () => {});
  checkinPooledExternalSession('conv-bin', {
    fingerprint: 'fp-1',
    executablePath: binPath,
    resource: { tag: 'v1' },
    isAlive: () => true,
    dispose,
  });

  // Unchanged binary returns the warm resource.
  const hit = await checkoutPooledExternalSession<{ tag: string }>('conv-bin', 'fp-1');
  expect(hit?.tag).toBe('v1');

  // Re-checkin, then simulate upgrading the binary on disk (mtime bump).
  checkinPooledExternalSession('conv-bin', {
    fingerprint: 'fp-1',
    executablePath: binPath,
    resource: { tag: 'v1' },
    isAlive: () => true,
    dispose,
  });
  const future = new Date(Date.now() + 10_000);
  utimesSync(binPath, future, future);

  const afterUpgrade = await checkoutPooledExternalSession<{ tag: string }>('conv-bin', 'fp-1');
  expect(afterUpgrade).toBeUndefined();
  expect(dispose).toHaveBeenCalledWith(true);
});

it('resolves nominal context windows and runs headless external turns via runExternalDirectTurn', async () => {
  expect(resolveExternalContextWindow({ kind: 'codex' })).toBe(272_000);
  expect(resolveExternalContextWindow({ kind: 'claude' })).toBe(200_000);
  expect(resolveExternalContextWindow({ kind: 'agy' })).toBe(1_000_000);

  const root = makeTempDir('xopc-direct-ext-');
  const fakeClaude = join(root, 'fake-claude');
  writeFileSync(
    fakeClaude,
    `#!${process.execPath}
import { createInterface } from 'node:readline';
const send = (f) => process.stdout.write(JSON.stringify(f) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.type === 'control_request') {
    send({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } });
    return;
  }
  if (msg.type === 'user') {
    send({ type: 'system', subtype: 'init', session_id: 'direct-claude-1', model: 'claude-sonnet-4-6' });
    send({ type: 'stream_event', session_id: 'direct-claude-1', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    send({ type: 'stream_event', session_id: 'direct-claude-1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } } });
    send({ type: 'stream_event', session_id: 'direct-claude-1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'from channel!' } } });
    send({ type: 'stream_event', session_id: 'direct-claude-1', event: { type: 'content_block_stop', index: 0 } });
    send({ type: 'result', subtype: 'success', is_error: false, session_id: 'direct-claude-1', result: 'Hello from channel!' });
  }
});
`,
    'utf8',
  );
  chmodSync(fakeClaude, 0o755);

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
      { id: 'claude-ch', enabled: true, execution: { kind: 'claude', binaryPath: fakeClaude }, profile: { name: 'Claude' } },
    ],
  });
  const project = new ProjectStore().create({ name: 'Channel Repo', workspaceRoot: root });
  const conv = createConversation({ agentId: 'claude-ch', projectId: project.id }, root);

  const updates: string[] = [];
  const res = await runExternalDirectTurn({
    conversationId: conv.key,
    content: 'Ping from Telegram',
    onTextUpdate: (full) => updates.push(full),
  });

  expect(res?.text).toBe('Hello from channel!');
  expect(updates).toEqual(['Hello ', 'Hello from channel!']);
});
