import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { CapabilityDispatcher } from '../../../capabilities/runtime/dispatcher.js';
import { ConfigSchema } from '../../../config/schema.js';
import { authenticateMcpConnection } from '../../../mcp/connection-grants.js';
import { mcpSessionTools, registerSessionTools } from '../../../mcp/session-tools.js';
import { createMcpProjectScopeAuthorizer, filterMcpOutputForProjects } from '../../../mcp/scope-guard.js';
import { ProjectStore } from '../../../projects/project-store.js';
import { createCollaborationRule } from '../../../storage/sqlite/collaboration-rule-repository.js';
import { updateSessionConfig } from '../../../storage/sqlite/config-repository.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../storage/sqlite/connection.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { appendTranscriptEntry } from '../../../storage/sqlite/transcript-repository.js';
import { applyUserProfilePatch, createUserGoal } from '../../../user-model/index.js';
import {
  buildExternalWarmContextBrief,
  disposeAllPooledExternalSessions,
  resolveExternalTurnMcpContext,
  revokeAllExternalSessionMcpGrants,
  revokeExternalSessionMcpGrant,
  runExternalProjectTurn,
  setActiveExternalMcpGatewayPort,
} from '../index.js';

const tempDirs: string[] = [];
const originalStateDir = process.env.XOPC_STATE_DIR;

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  setActiveExternalMcpGatewayPort(undefined);
  revokeAllExternalSessionMcpGrants();
  await disposeAllPooledExternalSessions(true);
  closeXopcDatabase();
  if (originalStateDir === undefined) delete process.env.XOPC_STATE_DIR;
  else process.env.XOPC_STATE_DIR = originalStateDir;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

it('exposes xopc.sessions.{list,search,read} via MCP with FTS5 search and project-scope isolation', async () => {
  const root = makeTempDir('xopc-mcp-sessions-');
  openXopcDatabase({ path: join(root, 'xopc.db') });

  const projects = new ProjectStore();
  const projA = projects.create({ name: 'Alpha', workspaceRoot: root });
  const projB = projects.create({ name: 'Beta', workspaceRoot: root });

  const convA = createConversation({ agentId: 'main', projectId: projA.id, name: 'Migration Plan' }, root);
  const convB = createConversation({ agentId: 'main', projectId: projB.id, name: 'Other Project' }, root);
  const hidden = createConversation({
    agentId: 'main',
    projectId: projA.id,
    name: 'Hidden',
    hiddenFromSessionList: true,
    customData: { keepHiddenFromSessionList: true },
  }, root);

  appendTranscriptEntry(convA.key, {
    role: 'user',
    content: 'We decided to use SQLite WAL mode for checkpoint storage.',
    timestamp: Date.now(),
  });
  appendTranscriptEntry(convA.key, {
    role: 'assistant',
    content: [{ type: 'text', text: 'Confirmed: SQLite WAL mode keeps checkpoint writes safe.' }],
    timestamp: Date.now(),
  });
  appendTranscriptEntry(convB.key, {
    role: 'user',
    content: 'SQLite WAL mode mentioned in Beta project.',
    timestamp: Date.now(),
  });
  appendTranscriptEntry(hidden.key, {
    role: 'user',
    content: 'Secret hidden SQLite WAL note.',
    timestamp: Date.now(),
  });

  const dispatcher = new CapabilityDispatcher();
  registerSessionTools(dispatcher);
  for (const [id, spec] of Object.entries(mcpSessionTools)) {
    dispatcher.exposeToMcp(id, spec);
  }

  const ctx = {
    principalId: 'mcp:test',
    actor: { kind: 'agent' as const, id: 'external' },
    surface: 'mcp' as const,
    scopes: ['workspace.read' as const],
    authorize: () => true,
  };

  // List excludes hidden sessions
  const listed = await dispatcher.call('xopc.sessions.list', { limit: 20 }, ctx) as {
    items: Array<{ conversationId: string; projectId?: string }>;
  };
  expect(listed.items.map((i) => i.conversationId)).toContain(convA.key);
  expect(listed.items.map((i) => i.conversationId)).toContain(convB.key);
  expect(listed.items.map((i) => i.conversationId)).not.toContain(hidden.key);

  // Search finds via FTS5 and filters cleanly with project scope
  const searched = await dispatcher.call('xopc.sessions.search', { query: 'SQLite WAL' }, ctx) as {
    query: string;
    items: Array<{ conversationId: string; projectId?: string; snippet?: string }>;
  };
  expect(searched.items.map((i) => i.conversationId)).toContain(convA.key);
  expect(searched.items.map((i) => i.conversationId)).not.toContain(hidden.key);

  const filtered = filterMcpOutputForProjects('xopc.sessions.search', searched, [projA.id]) as typeof searched;
  expect(filtered.items.map((i) => i.conversationId)).toEqual([convA.key]);

  // Project scope authorizer blocks reading sessions from other projects
  const authorize = createMcpProjectScopeAuthorizer(
    ['xopc.sessions.list', 'xopc.sessions.search', 'xopc.sessions.read'],
    [projA.id],
  );
  expect(await authorize('xopc.sessions.read', { conversationId: convA.key })).toBe(true);
  expect(await authorize('xopc.sessions.read', { conversationId: convB.key })).toBe(false);

  // Read returns clean messages
  const read = await dispatcher.call('xopc.sessions.read', { conversationId: convA.key }, ctx) as {
    conversationId: string;
    messages: Array<{ role: string; text: string }>;
  };
  expect(read.messages).toEqual([
    expect.objectContaining({ role: 'user', text: 'We decided to use SQLite WAL mode for checkpoint storage.' }),
    expect.objectContaining({ role: 'assistant', text: 'Confirmed: SQLite WAL mode keeps checkpoint writes safe.' }),
  ]);
});

it('auto-mounts scoped built-in xopc MCP server by contextAccess tier and revokes grants cleanly', () => {
  const root = makeTempDir('xopc-mcp-automount-');
  process.env.XOPC_STATE_DIR = root;
  openXopcDatabase({ path: join(root, 'xopc.db') });

  const cfg = ConfigSchema.parse({});
  const project = new ProjectStore().create({ name: 'Atlas', workspaceRoot: root });
  const conv = createConversation({ agentId: 'codex-1', projectId: project.id, sourceChannel: 'webchat' }, root);

  // Off & brief_only do not mount built-in xopc MCP
  expect(resolveExternalTurnMcpContext({
    workspaceDir: root,
    agentId: 'codex-1',
    conversationId: conv.key,
    projectId: project.id,
    contextAccess: 'off',
    gatewayPort: 18790,
    cfg,
  }).builtInMounted).toBe(false);

  expect(resolveExternalTurnMcpContext({
    workspaceDir: root,
    agentId: 'codex-1',
    conversationId: conv.key,
    projectId: project.id,
    contextAccess: 'brief_only',
    gatewayPort: 18790,
    cfg,
  }).builtInMounted).toBe(false);

  // read_only mounts built-in xopc stdio MCP with read-only capabilities scoped to project.id
  const readOnly = resolveExternalTurnMcpContext({
    workspaceDir: root,
    agentId: 'codex-1',
    conversationId: conv.key,
    projectId: project.id,
    contextAccess: 'read_only',
    gatewayPort: 18790,
    cfg,
  });
  expect(readOnly.builtInMounted).toBe(true);
  const xopcSpec = readOnly.servers.find((s) => s.name === 'xopc');
  expect(xopcSpec?.transport).toBe('stdio');
  const token = xopcSpec?.transport === 'stdio' ? xopcSpec.env?.XOPC_MCP_TOKEN : undefined;
  expect(token).toMatch(/^xopc_mcp_/);

  const auth = authenticateMcpConnection(token!);
  expect(auth?.projectIds).toEqual([project.id]);
  expect(auth?.capabilityIds).toContain('xopc.user_context.profile');
  expect(auth?.capabilityIds).toContain('xopc.knowledge.search');
  expect(auth?.capabilityIds).toContain('xopc.sessions.search');
  expect(auth?.capabilityIds).toContain('xopc.notes.list');
  expect(auth?.capabilityIds).not.toContain('xopc.notes.create');

  // read_write upgrades the grant to include write capabilities and revokes old token
  const readWrite = resolveExternalTurnMcpContext({
    workspaceDir: root,
    agentId: 'codex-1',
    conversationId: conv.key,
    projectId: project.id,
    contextAccess: 'read_write',
    gatewayPort: 18790,
    cfg,
  });
  const writeSpec = readWrite.servers.find((s) => s.name === 'xopc');
  const writeToken = writeSpec?.transport === 'stdio' ? writeSpec.env?.XOPC_MCP_TOKEN : undefined;
  expect(writeToken).toBeTruthy();
  expect(writeToken).not.toBe(token);
  expect(authenticateMcpConnection(token!)).toBeNull();
  const writeAuth = authenticateMcpConnection(writeToken!);
  expect(writeAuth?.capabilityIds).toContain('xopc.notes.create');
  expect(writeAuth?.capabilityIds).toContain('xopc.tasks.create');

  // Revoke cleans up the grant immediately
  revokeExternalSessionMcpGrant(conv.key);
  expect(authenticateMcpConnection(writeToken!)).toBeNull();
});

it('builds warm context brief respecting privacy tiers and injects both brief and built-in xopc MCP into external turns', async () => {
  const root = makeTempDir('xopc-warm-brief-');
  process.env.XOPC_STATE_DIR = root;
  openXopcDatabase({ path: join(root, 'xopc.db') });

  const cfg = ConfigSchema.parse({});
  const project = new ProjectStore().create({
    name: 'Apollo Engine',
    description: 'Local-first coding workbench',
    outcome: 'Ship reliable multi-runtime sessions',
    workspaceRoot: root,
  });

  applyUserProfilePatch({ callName: 'Alex', role: 'Staff Engineer', timezone: 'Asia/Shanghai' });
  createCollaborationRule({
    category: 'communication',
    statement: 'Keep summaries concise and always cite file paths.',
    priority: 10,
    scope: { type: 'global' },
    conditions: {},
  });
  createUserGoal({
    title: 'External Runtime Parity',
    desiredOutcome: 'Codex, AGY, and Claude share xopc context cleanly',
    scope: { type: 'project', id: project.id },
  });

  const conv = createConversation({ agentId: 'claude-ctx', projectId: project.id, sourceChannel: 'webchat' }, root);

  // off -> undefined
  expect(buildExternalWarmContextBrief({
    conversationId: conv.key,
    projectId: project.id,
    contextAccess: 'off',
    builtInMcpMounted: false,
    cfg,
  })).toBeUndefined();

  // brief_only -> user + project brief, no MCP hint
  const briefOnly = buildExternalWarmContextBrief({
    conversationId: conv.key,
    projectId: project.id,
    contextAccess: 'brief_only',
    builtInMcpMounted: false,
    cfg,
  });
  expect(briefOnly).toContain('Preferred name: Alex');
  expect(briefOnly).toContain('Keep summaries concise');
  expect(briefOnly).toContain('Apollo Engine');
  expect(briefOnly).not.toContain('xopc MCP Tools');

  // read_only + mounted -> includes MCP hint
  const fullBrief = buildExternalWarmContextBrief({
    conversationId: conv.key,
    projectId: project.id,
    contextAccess: 'read_only',
    builtInMcpMounted: true,
    cfg,
  });
  expect(fullBrief).toContain('xopc MCP Tools (read-only)');
  expect(fullBrief).toContain('xopc_sessions_search');

  // userContextMode = 'off' suppresses user profile while keeping project brief
  updateSessionConfig(conv.key, { userContextMode: 'off' }, root);
  const suppressedBrief = buildExternalWarmContextBrief({
    conversationId: conv.key,
    projectId: project.id,
    contextAccess: 'read_only',
    builtInMcpMounted: false,
    cfg,
  });
  expect(suppressedBrief).not.toContain('Preferred name: Alex');
  expect(suppressedBrief).toContain('Apollo Engine');

  // Re-enable userContextMode and verify end-to-end injection into runExternalProjectTurn (Claude driver)
  updateSessionConfig(conv.key, { userContextMode: 'enabled' }, root);
  setActiveExternalMcpGatewayPort(18790);

  const logPath = join(root, 'claude-ctx.log');
  const fakeClaude = join(root, 'fake-claude');
  writeFileSync(
    fakeClaude,
    `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const logPath = ${JSON.stringify(logPath)};
appendFileSync(logPath, JSON.stringify({ event: 'spawn', argv: process.argv.slice(2) }) + '\\n');
const send = (f) => process.stdout.write(JSON.stringify(f) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  appendFileSync(logPath, JSON.stringify({ event: 'in', msg }) + '\\n');
  if (msg.type === 'control_request') {
    send({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } });
    return;
  }
  if (msg.type === 'user') {
    send({ type: 'system', subtype: 'init', session_id: 'ctx-sess-1', model: 'claude-sonnet-4-6' });
    send({ type: 'stream_event', session_id: 'ctx-sess-1', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    send({ type: 'stream_event', session_id: 'ctx-sess-1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Got context!' } } });
    send({ type: 'stream_event', session_id: 'ctx-sess-1', event: { type: 'content_block_stop', index: 0 } });
    send({ type: 'result', subtype: 'success', is_error: false, session_id: 'ctx-sess-1', result: 'Got context!' });
  }
});
`,
    'utf8',
  );
  chmodSync(fakeClaude, 0o755);

  seedTestAgentCatalog({
    defaults: {
      models: { chat: { primary: 'openai/gpt-5', fallbacks: [] }, intents: {} },
      skills: { mode: 'all-enabled', exclude: [] },
      tools: {},
      runtime: {},
    },
    agents: [
      { id: 'main', enabled: true, profile: { name: 'Main' } },
      { id: 'claude-ctx', enabled: true, execution: { kind: 'claude', binaryPath: fakeClaude, contextAccess: 'read_only' }, profile: { name: 'Claude' } },
    ],
  });

  await Array.fromAsync(runExternalProjectTurn({
    conversationId: conv.key,
    transcriptId: conv.transcriptId!,
    agentId: 'claude-ctx',
    execution: { kind: 'claude', binaryPath: fakeClaude, contextAccess: 'read_only' },
    instructions: 'Custom agent rule.',
    runId: 'ctx-run-1',
    content: 'Check context',
    hasAttachmentsOrContext: false,
    signal: new AbortController().signal,
  }));

  const logs = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const spawn = logs.find((e) => e.event === 'spawn');
  const sysIdx = spawn?.argv?.indexOf('--append-system-prompt') ?? -1;
  expect(sysIdx).toBeGreaterThan(-1);
  const appendedPrompt = spawn.argv[sysIdx + 1] as string;
  expect(appendedPrompt).toContain('Custom agent rule.');
  expect(appendedPrompt).toContain('<xopc_context>');
  expect(appendedPrompt).toContain('Apollo Engine');
  expect(appendedPrompt).toContain('xopc MCP Tools (read-only)');

  const mcpSet = logs.find((e) => e.event === 'in' && e.msg?.request?.subtype === 'mcp_set_servers');
  expect(mcpSet?.msg?.request?.servers?.xopc).toEqual(expect.objectContaining({
    type: 'stdio',
    args: expect.arrayContaining(['mcp', 'serve', '--stdio', '--port', '18790']),
    env: expect.objectContaining({ XOPC_MCP_TOKEN: expect.stringMatching(/^xopc_mcp_/) }),
  }));
});
