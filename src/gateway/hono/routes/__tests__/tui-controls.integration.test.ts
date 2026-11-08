import { GatewaySessionsApi } from '../../../service/sessions-api.js';
import { SessionIndex } from '../../../../session/index.js';
import { PLUGIN_SCHEMA } from '../../../../extensions/agent-plugins/validation.js';
import { acquireEmbeddedRunLease } from '../../../../agent/embedded/runs.js';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { commandRegistry } from '../../../../agent/commands/command-registry.js';
import { monitorChildRun } from '../../../../agent/orchestration/child-run-monitor.js';
import { allowsExecutionTool, resolveExecutionToolPolicy } from '../../../../agent/embedded/execution-tool-policy.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { ProjectService } from '../../../../projects/index.js';
import { appendTranscriptEntry, closeXopcDatabase, ensureSessionRecord, getClarificationSnapshot, resolveClarification } from '../../../../storage/sqlite/index.js';
import { GatewayRealtimeBackend } from '../../../../tui/backends/gateway-realtime-backend.js';
import { createGatewayCredential } from '../../../credential.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';

it('serves authenticated TUI controls through the lazy Gateway and real runtime services', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xopc-tui-http-'));
  vi.stubEnv('XOPC_STATE_DIR', dir);
  vi.stubEnv('PI_CODING_AGENT_DIR', join(dir, 'pi'));
  const workspace = join(dir, 'workspace'); await mkdir(workspace);
  const mcpScript = join(dir, 'mcp.cjs');
  await writeFile(mcpScript, `require('readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;const result=q.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:q.method==='tools/list'?{tools:[{name:'inspect',description:'Inspect fixture',inputSchema:{type:'object',properties:{}}}]}:{};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n')})`);
  initializeTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace }] });
  const auth = { mode: 'token' as const, token: 'isolated-tui-test' };
  const config = ConfigSchema.parse({ gateway: { auth }, mcp: { servers: { fixture: { command: process.execPath, args: [mcpScript] } } } });
  const id = '5f8923f9-52c1-47a6-8174-bfe092661681';
  const other = '5f8923f9-52c1-47a6-8174-bfe092661682';
  ensureSessionRecord(id, workspace, { agentId: 'main' });
  const projects = new ProjectService();
  projects.attachSession(id, projects.create({ name: 'TUI fixture', workspaceRoot: workspace }).id);
  const index = new SessionIndex({ config }); await index.initialize();
  const sessions = new GatewaySessionsApi({ sessionIndex: index, getAgentService: () => { throw new Error('No model service in this HTTP fixture'); }, getActiveWebchatRunId: () => undefined, listActiveWebchatRuns: () => [], listActiveExecutions: () => [] });
  vi.spyOn(sessions, 'btwQuery').mockImplementation(async (_id, _question, options) => { await options?.onTextDelta?.('你好'); await options?.onTextDelta?.('，side'); return { text: '你好，side' }; });
  const service = {
    currentConfig: config, getConfig: () => config,
    getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    isGatewayReady: () => true, getHealth: () => ({ status: 'healthy' }),
    sessions, sessionIndexInstance: index,
    getClarificationState: getClarificationSnapshot, resolveClarificationResponse: resolveClarification,
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  let jobId: string | undefined;
  let child: ReturnType<typeof monitorChildRun> | undefined;
  try {
    if (!gateway.listening) await once(gateway, 'listening');
    const address = gateway.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const url = `http://127.0.0.1:${address.port}`;
    const backend = new GatewayRealtimeBackend({ url, credential: createGatewayCredential('token', auth.token) });
    expect((await fetch(`${url}/api/tui/sessions/${id}/policy`)).status).toBe(401);
    expect(await backend.setInteractionPolicy(id, { mode: 'plan', access: 'configured' })).toEqual({ mode: 'plan', access: 'configured' });
    expect(allowsExecutionTool(resolveExecutionToolPolicy(id), 'write_file')).toBe(false);
    expect(await backend.getInteractionPolicy(other)).toEqual({ mode: 'default', access: 'configured' });
    await backend.setInteractionPolicy(id, { mode: 'default', access: 'configured' });

    execFileSync('git', ['init', '-q', workspace]);
    await writeFile(join(workspace, 'tracked.txt'), 'before\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: workspace });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: workspace });
    await writeFile(join(workspace, 'tracked.txt'), 'after\n');
    await writeFile(join(workspace, 'added.txt'), 'new-file\n');
    const diff = await backend.getWorkspaceDiff(id);
    expect(diff).toContain('-before');
    expect(diff).toContain('+after');
    expect(diff).toContain('added.txt');

    const job = await commandRegistry().start({ owner: id,
      command: `node -e "process.stdout.write('ready');setInterval(()=>{},1000)"`,
      cwd: workspace, tty: true, env: process.env, timeoutMs: 10_000 });
    jobId = job.id;
    await backend.resizeJob(id, job.id, 88, 28);
    expect((await backend.getJob(id, job.id)).cols).toBe(88);
    await expect(backend.resizeJob(other, job.id, 90, 30)).rejects.toThrow('409');
    expect((await backend.listJobs(id)).some(item => item.id === job.id)).toBe(true);
    await expect(backend.getJob(other, job.id)).rejects.toThrow('404');
    await expect(backend.setInteractionPolicy(id, { mode: 'plan', access: 'configured' })).rejects.toThrow('409');
    await backend.stopJob(id, job.id);
    expect((await backend.getJob(id, job.id)).status).toBe('cancelled');

    child = monitorChildRun({ id: 'child-fixture', parentConversationId: id, task: 'Inspect fixture', abort: vi.fn() });
    child.append('source evidence');
    child.snapshot([{ role: 'user', content: 'child question', timestamp: Date.now() }]);
    expect(await backend.getSubagentTranscript(id, 'child-fixture')).toContain('child question');
    await expect(backend.getSubagentTranscript(other, 'child-fixture')).rejects.toThrow('404');
    const steer = vi.fn(async () => 'queued');
    const lease = acquireEmbeddedRunLease({ conversationId: 'child-fixture', runId: 'fixture-run', transcriptId: 'fixture-transcript' });
    await lease.attach({ steer } as never, async () => {});
    try { await backend.steerSubagent(id, 'child-fixture', 'inspect the next file'); expect(steer).toHaveBeenCalledWith('inspect the next file'); } finally { lease.release(); }
    await expect(backend.setInteractionPolicy(id, { mode: 'plan', access: 'configured' })).rejects.toThrow('409');
    expect((await backend.listSubagents(id))[0]?.output).toContain('source evidence');
    await expect(backend.getSubagent(other, 'child-fixture')).rejects.toThrow('404');
    child.finish('success', 'Inspection complete');
    expect((await backend.getSubagent(id, 'child-fixture')).status).toBe('success');
    await backend.setInteractionPolicy(id, { mode: 'plan', access: 'configured' });
    expect(Array.isArray(await backend.listCapabilities(id, 'mcp'))).toBe(true);
    expect(Array.isArray(await backend.listCapabilities(id, 'plugins'))).toBe(true);
    expect(await backend.getClarification(id)).toBeNull();
    appendTranscriptEntry(id, { role: 'user', content: 'Find 青禾 marker in this conversation', timestamp: Date.now() });
    expect((await backend.searchHistory(id, '青禾'))[0]?.rowNumber).toBe(1);
    expect((await backend.loadHistory({ conversationId: id, limit: 10 })).messages[0]?.content).toContain('青禾');
    await backend.archiveSession(id);
    expect((await backend.listSessions({ archived: true })).some(session => session.key === id)).toBe(true);
    expect((await backend.listSessions()).some(session => session.key === id)).toBe(false);
    await backend.restoreSession(id);
    expect((await backend.listSessions()).some(session => session.key === id)).toBe(true);
    expect(await backend.searchHistory(other, '青禾')).toEqual([]);
    const deltas: string[] = [];
    expect(await backend.sideQuery(id, 'side question', { onDelta: delta => { deltas.push(delta); } })).toEqual({ text: '你好，side' });
    expect(deltas).toEqual(['你好', '，side']);
    expect(await backend.manageCapability(id, { action: 'mcp.probe', id: 'fixture' })).toMatchObject({ state: 'connected', toolCount: 1 });
    const pluginSource = join(dir, 'plugin'); await mkdir(pluginSource);
    await writeFile(join(pluginSource, 'plugin.json'), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'tui-fixture', version: '1.0.0' }));
    const inspection = await backend.manageCapability(id, { action: 'plugin.inspect', source: pluginSource }) as { reviewHash: string };
    await expect(backend.manageCapability(id, { action: 'plugin.install', source: pluginSource, reviewHash: 'stale' })).rejects.toThrow('400');
    expect(await backend.manageCapability(id, { action: 'plugin.install', source: pluginSource, reviewHash: inspection.reviewHash })).toMatchObject({ pluginId: 'tui-fixture' });
    await backend.manageCapability(id, { action: 'plugin.remove', id: 'tui-fixture', credentials: false });
    await backend.setInteractionPolicy(id, { mode: 'default', access: 'configured' });
    await writeFile(join(workspace, '.git/info/exclude'), '*\n');
    await writeFile(join(workspace, 'tracked.txt'), 'before\n');
    const environment = await backend.manageCapability(id, { action: 'worktree.create', baseRef: 'HEAD' }) as { id: string; rootPath: string };
    expect(environment.rootPath).not.toBe(workspace);
    expect(await backend.manageCapability(id, { action: 'worktree.list' })).toEqual(expect.arrayContaining([expect.objectContaining({ id: environment.id })]));
    await backend.manageCapability(id, { action: 'worktree.remove', id: environment.id });

  } finally {
    if (jobId) await commandRegistry().cancel(id, jobId);
    child?.dispose();
    gateway.closeAllConnections();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    closeXopcDatabase();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
