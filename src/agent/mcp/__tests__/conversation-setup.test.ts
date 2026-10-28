import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { saveWeixinAccount } from '../../../../extensions/weixin/src/auth/accounts.js';
import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { ConfigSchema, type Config } from '../../../config/schema.js';
import { openXopcDatabase, closeXopcDatabase } from '../../../storage/sqlite/connection.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { McpConversationSetup } from '../conversation-setup.js';
import { McpDiscovery } from '../discovery.js';
import { resolveConnectorSecretReferences } from '../../../connectors/secret-store.js';
import { CredentialResolver } from '../../../auth/credentials.js';
import { mcpConfigRevision } from '../connection-drafts.js';
import { createMcpSetupTool } from '../../tools/mcp-setup-tool.js';
import { withCoreToolExposure } from '../../tools/toolExposure.js';
import { getXopcToolMetadata } from '../../embedded/tool-metadata.js';

const native = vi.hoisted(() => ({ probeMcpConnection: vi.fn(), getMcpAuthorization: vi.fn(), startMcpAuthorization: vi.fn(), cancelMcpAuthorization: vi.fn(), submitMcpRedirect: vi.fn() }));
vi.mock('../connection-setup.js', () => native);
vi.mock('../tool-catalog.js', () => ({ discoverMcpTools: vi.fn(async () => []) }));
let root: string, config: Config, service: McpConversationSetup, context: { conversationId: string; agentId: string; canConfigure: boolean };
let resume: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); root = mkdtempSync(join(tmpdir(), 'xopc-mcp-conversation-'));
  for (const [key, value] of Object.entries({ XOPC_STATE_DIR: root, XOPC_WORKSPACE: root, XOPC_CREDENTIALS_DIR: join(root, 'credentials'), PI_CODING_AGENT_DIR: join(root, 'pi') })) vi.stubEnv(key, value);
  openXopcDatabase({ path: join(root, 'xopc.db') }); initializeTestAgentCatalog({ agents: [{ id: 'main', workspace: root }] });
  const session = createConversation({ agentId: 'main', sourceChannel: 'webchat' });
  context = { conversationId: session.key, agentId: 'main', canConfigure: true };
  config = ConfigSchema.parse({ mcp: { servers: { unrelated: { command: 'node', enabled: false } } } });
  resume = vi.fn(async () => true);
  service = new McpConversationSetup({ readConfig: () => config, saveConfig: async next => { config = next; return { saved: true }; }, withConfigLock: operation => operation(), resume });
  native.probeMcpConnection.mockResolvedValue({ state: 'connected', toolCount: 1 });
});
afterEach(() => { service.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); closeXopcDatabase(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
async function start() { return await service.command('start', { serverId: 'docs', url: 'http://127.0.0.1:12345/mcp', purpose: 'Read my profile' }, context) as any; }

it('stores multiple custom header fields only as secret references and verifies them before commit', async () => {
  const goal = await service.command('start', { serverId: 'docs', url: 'https://fixture.example/mcp', purpose: 'Read', authentication: 'header',
    secretFields: [{ id: 'key', label: 'API key', location: 'header', name: 'X-API-Key' }, { id: 'tenant', label: 'Tenant', location: 'header', name: 'X-Tenant-Token' }] }, context) as any;
  const pending = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context) as any;
  expect(pending.phase).toBe('token_required'); expect(native.probeMcpConnection).not.toHaveBeenCalled();
  await expect(service.interact(goal.setupId, 'token', { key: 'private-key' }, pending.version)).rejects.toThrow('every requested');
  const ready = await service.interact(goal.setupId, 'token', { key: 'private-key', tenant: 'private-tenant' }, pending.version) as any;
  expect(ready.phase).toBe('ready');
  expect(await resolveConnectorSecretReferences(config.mcp!.servers!.docs.headers)).toEqual({ 'X-API-Key': 'private-key', 'X-Tenant-Token': 'private-tenant' });
  expect(JSON.stringify(config)).not.toMatch(/private-key|private-tenant/); expect(resume).toHaveBeenCalledTimes(1);
});

it('requires an exact owner-reviewed stdio plan before connecting or saving environment credentials', async () => {
  const goal = await service.command('start', { serverId: 'docs', purpose: 'Read', transport: 'stdio', objective: 'complete_task',
    execution: { command: process.execPath, args: ['fixture.mjs'], sourceUrl: 'https://fixture.example/guide' },
    secretFields: [{ id: 'key', label: 'Access key', location: 'env', name: 'FIXTURE_ACCESS_KEY' }] }, context) as any;
  expect(goal.phase).toBe('approval_required'); expect(goal.planApproval.execution.command).toBe(process.execPath);
  await expect(service.interact(goal.setupId, 'token', { key: 'private-env' }, goal.version)).rejects.toThrow('Approve');
  expect(native.probeMcpConnection).not.toHaveBeenCalled();
  const approved = await service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner') as any;
  expect(approved.phase).toBe('token_required'); expect(native.probeMcpConnection).not.toHaveBeenCalled();
  expect(await service.interact(goal.setupId, 'token', { key: 'private-env' }, approved.version)).toMatchObject({ phase: 'ready' });
  expect(config.mcp!.servers!.docs).toMatchObject({ type: 'stdio', command: process.execPath, xopcManagedStdio: true });
  expect(await resolveConnectorSecretReferences(config.mcp!.servers!.docs.env)).toEqual({ FIXTURE_ACCESS_KEY: 'private-env' });
  expect(JSON.stringify(config)).not.toContain('private-env');
});

it('persists Retry-After across a Gateway restart and does not probe early', async () => {
  vi.useFakeTimers(); const retryAt = Date.now() + 5000;
  native.probeMcpConnection.mockResolvedValueOnce({ state: 'error', errorCode: 'rate_limited', recovery: { kind: 'wait', retryAt } }).mockResolvedValue({ state: 'connected', toolCount: 1 });
  const goal = await start(); const waiting = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context) as any;
  expect(waiting.nextRetryAt).toBe(retryAt);
  await service.command('advance', { setupId: goal.setupId, expectedVersion: waiting.version }, context); expect(native.probeMcpConnection).toHaveBeenCalledTimes(1);
  service.dispose(); service = new McpConversationSetup({ readConfig: () => config, saveConfig: async next => { config = next; return { saved: true }; }, withConfigLock: fn => fn(), resume });
  await service.resumePending(true); await vi.advanceTimersByTimeAsync(4999); expect(native.probeMcpConnection).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2); expect(native.probeMcpConnection).toHaveBeenCalledTimes(2); expect(resume).toHaveBeenCalledTimes(1);
});

it('stops retrying after cancellation and after three failed probes', async () => {
  vi.useFakeTimers(); native.probeMcpConnection.mockResolvedValue({ state: 'error', errorCode: 'network' });
  const first = await start(); const waiting = await service.command('advance', { setupId: first.setupId, expectedVersion: first.version }, context) as any;
  await service.command('cancel', { setupId: first.setupId, expectedVersion: waiting.version }, context); await vi.advanceTimersByTimeAsync(10_000);
  expect(native.probeMcpConnection).toHaveBeenCalledTimes(1);
  const next = await start(); await service.command('advance', { setupId: next.setupId, expectedVersion: next.version }, context);
  await vi.advanceTimersByTimeAsync(20_000); expect(native.probeMcpConnection).toHaveBeenCalledTimes(4);
  const final = await service.command('get', { setupId: next.setupId }, context) as any;
  await service.command('advance', { setupId: next.setupId, expectedVersion: final.version }, context);
  expect(native.probeMcpConnection).toHaveBeenCalledTimes(4); expect(resume).not.toHaveBeenCalled();
});

it('requests a known Bearer Token before any unauthenticated connection probe', async () => {
  const goal = await service.command('start', { serverId: 'docs', url: 'https://fixture.example/mcp', purpose: 'Read', authentication: 'bearer' }, context) as any;
  const pending = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context) as any;
  expect(pending.phase).toBe('token_required'); expect(native.probeMcpConnection).not.toHaveBeenCalled();
  expect(await service.interact(goal.setupId, 'get')).toMatchObject({ requiresRecheck: false });
  const ready = await service.interact(goal.setupId, 'token', 'private-first-token', pending.version) as any;
  expect(ready.phase).toBe('ready'); expect(native.probeMcpConnection).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(config)).not.toContain('private-first-token'); expect(resume).toHaveBeenCalledTimes(1);
});

it('recovers first-time Token input from an access-denied goal after Gateway restart', async () => {
  native.probeMcpConnection.mockResolvedValue({ state: 'error', errorCode: 'access_denied' });
  const goal = await start();
  const blocked = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context) as any;
  expect(blocked).toMatchObject({ phase: 'blocked', canProvideToken: true });
  const restarted = new McpConversationSetup({ readConfig: () => config, saveConfig: async next => { config = next; return { saved: true }; }, withConfigLock: operation => operation(), resume });
  expect(await restarted.interact(goal.setupId, 'get')).toMatchObject({ canProvideToken: true, requiresRecheck: true });
  const refreshed = await restarted.interact(goal.setupId, 'advance', undefined, blocked.version) as any;
  native.probeMcpConnection.mockResolvedValueOnce({ state: 'token_required' });
  const rejected = await restarted.interact(goal.setupId, 'token', 'wrong-first-token', refreshed.version) as any;
  expect(rejected).toMatchObject({ phase: 'token_required', errorCode: 'credential_rejected' });
  expect(config.mcp!.servers!.docs).toBeUndefined(); expect(resume).not.toHaveBeenCalled();
  native.probeMcpConnection.mockResolvedValueOnce({ state: 'connected', toolCount: 1 });
  expect(await restarted.interact(goal.setupId, 'token', 'correct-first-token', rejected.version)).toMatchObject({ phase: 'ready' });
  expect(resume).toHaveBeenCalledTimes(1);
});

it.each(['network', 'tls', 'rate_limited'])('does not turn %s errors into first-time Token input', async errorCode => {
  native.probeMcpConnection.mockResolvedValueOnce({ state: 'error', errorCode });
  const goal = await start(); const blocked = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context) as any;
  expect(blocked.canProvideToken).toBe(false);
  await expect(service.interact(goal.setupId, 'token', 'private-value', blocked.version)).rejects.toThrow('token is required');
});

it('refuses first-time Token input after cancellation or reset and rejects nonsecure Bearer hints', async () => {
  native.probeMcpConnection.mockResolvedValue({ state: 'error', errorCode: 'access_denied' });
  await expect(service.command('start', { serverId: 'docs', url: 'http://remote.example/mcp', purpose: 'Read', authentication: 'bearer' }, context)).rejects.toThrow('requires HTTPS');
  const goal = await start(); const blocked = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context) as any;
  const cancelled = await service.command('cancel', { setupId: goal.setupId, expectedVersion: blocked.version }, context) as any;
  await expect(service.interact(goal.setupId, 'token', 'private-value', cancelled.version)).rejects.toThrow('cancelled');
  const fresh = await start(); const waiting = await service.command('advance', { setupId: fresh.setupId, expectedVersion: fresh.version }, context) as any;
  const { resetSessionRecord } = await import('../../../storage/sqlite/session-repository.js');
  resetSessionRecord(context.conversationId, root);
  await expect(service.interact(fresh.setupId, 'token', 'private-value', waiting.version)).rejects.toThrow('changed');
  expect(resume).not.toHaveBeenCalled();
});

it('rejects expired forms and nonsecure remote first-time Token recovery', async () => {
  native.probeMcpConnection.mockResolvedValue({ state: 'error', errorCode: 'access_denied' });
  const remote = await service.command('start', { serverId: 'remote', url: 'http://remote.example/mcp', purpose: 'Read' }, context) as any;
  const denied = await service.command('advance', { setupId: remote.setupId, expectedVersion: remote.version }, context) as any;
  expect(denied.canProvideToken).toBe(false);
  await expect(service.interact(remote.setupId, 'token', 'private-value', denied.version)).rejects.toThrow('token is required');
  const goal = await start(); const blocked = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context) as any;
  await expect(service.interact(goal.setupId, 'token', 'private-value', blocked.version - 1)).rejects.toThrow('changed');
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
  await expect(service.interact(goal.setupId, 'token', 'private-value', blocked.version)).rejects.toThrow('no longer accepts');
  expect(resume).not.toHaveBeenCalled();
});

it('makes the small direct configuration entry available without relaxing host authority', async () => {
  const tool = withCoreToolExposure(createMcpSetupTool({ getMcpSetupService: () => service,
    getCurrentConversationId: () => context.conversationId, getCurrentAgentId: () => context.agentId,
    canConfigureFromConversation: () => context.canConfigure }));
  expect(getXopcToolMetadata(tool)?.exposure).not.toBe('deferred');
  context.canConfigure = false;
  const denied = await tool.execute('denied', { command: 'start', args: { serverId: 'docs', url: 'https://example.com/mcp', purpose: 'Read' } });
  expect(JSON.stringify(denied)).toContain('active owner');
  expect(config.mcp!.servers!.docs).toBeUndefined();
  context.canConfigure = true;
  const result = await tool.execute('start', { command: 'start', args: { serverId: 'docs', url: 'http://127.0.0.1:12345/mcp', purpose: 'Read' } });
  const goal = (result.details as any).result;
  await tool.execute('advance', { command: 'advance', args: { setupId: goal.setupId, expectedVersion: goal.version } });
  expect(config.mcp!.servers!.docs.url).toBe('http://127.0.0.1:12345/mcp');
  expect(resume).toHaveBeenCalledTimes(1);
});

it('commits the tested server, preserves unrelated config and resumes once', async () => {
  const goal = await start();
  const ready = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context) as any;
  expect(ready).toMatchObject({ phase: 'ready', continuationQueued: true });
  expect(config.mcp!.servers!.docs.url).toBe('http://127.0.0.1:12345/mcp');
  expect(config.mcp!.servers!.unrelated.enabled).toBe(false);
  await service.command('advance', { setupId: ready.setupId, expectedVersion: ready.version }, context);
  expect(resume).toHaveBeenCalledTimes(1);
});

it('refuses forged interactive authority, raw secrets and stale configuration', async () => {
  await expect(service.command('inspect', {}, { ...context, conversationId: 'missing-session' })).rejects.toThrow('Owner conversation required');
  await expect(service.command('start', { serverId: 'docs', url: 'https://example.com', purpose: 'Read' }, { ...context, canConfigure: false })).rejects.toThrow('active owner');
  await expect(service.command('start', { serverId: 'docs', url: 'https://example.com?token=private', purpose: 'Read' }, context)).rejects.toThrow('embedded credentials');
  const goal = await start(); config.mcp!.servers!.docs = { url: 'https://other.example/mcp' };
  await expect(service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context)).rejects.toThrow('Server changed');
  expect(resume).not.toHaveBeenCalled();
});

it('does not treat inherited object properties as configured servers', async () => {
  await expect(service.command('set_enabled', { serverId: '__proto__', enabled: true, expectedRevision: mcpConfigRevision({}) }, context)).rejects.toThrow('changed');
  await expect(service.command('start', { serverId: 'constructor', url: 'https://example.com/mcp', purpose: 'Read' }, context)).rejects.toThrow('reserved');
  expect(({} as { enabled?: boolean }).enabled).toBeUndefined();
});

it('keeps Token input out of plans, model responses and persisted MCP config', async () => {
  native.probeMcpConnection.mockResolvedValueOnce({ state: 'token_required' });
  const goal = await start();
  const pending = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context) as any;
  const ready = await service.interact(goal.setupId, 'token', 'private-test-token-value', pending.version) as any;
  expect(ready.phase).toBe('ready');
  expect(JSON.stringify(config)).not.toContain('private-test-token-value');
  expect(JSON.stringify(await service.command('inspect', {}, context))).not.toContain('private-test-token-value');
  expect(JSON.stringify(await service.command('get', { setupId: goal.setupId }, context))).not.toContain('private-test-token-value');
  expect(await resolveConnectorSecretReferences(config.mcp!.servers!.docs.headers)).toEqual({ Authorization: 'Bearer private-test-token-value' });
  await expect(service.interact(goal.setupId, 'token', 'second-value', pending.version)).rejects.toThrow();
});

it('does not commit or resume after cancellation during a network check', async () => {
  let release!: () => void;
  native.probeMcpConnection.mockImplementationOnce(async () => { await new Promise<void>(done => { release = done; }); return { state: 'connected', toolCount: 1 }; });
  const goal = await start();
  const advancing = service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const pending = await service.command('get', { setupId: goal.setupId }, context) as any;
  await service.command('cancel', { setupId: goal.setupId, expectedVersion: pending.version }, context);
  release(); await expect(advancing).rejects.toThrow('cancelled');
  expect(config.mcp!.servers!.docs).toBeUndefined(); expect(resume).not.toHaveBeenCalled();
});

it('consumes a secure form version before asynchronous credential writes', async () => {
  native.probeMcpConnection.mockResolvedValueOnce({ state: 'token_required' });
  const goal = await start();
  const pending = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context) as any;
  const original = CredentialResolver.prototype.saveApiKey;
  let release!: () => void;
  vi.spyOn(CredentialResolver.prototype, 'saveApiKey').mockImplementationOnce(async function (...args) {
    await new Promise<void>(done => { release = done; }); return original.apply(this, args);
  });
  const submitting = service.interact(goal.setupId, 'token', 'first-private-token', pending.version);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await expect(service.interact(goal.setupId, 'token', 'different-private-token', pending.version)).rejects.toThrow('changed');
  release(); await submitting;
  expect(await resolveConnectorSecretReferences(config.mcp!.servers!.docs.headers)).toEqual({ Authorization: 'Bearer first-private-token' });
});

it('returns no raw configured secrets or URLs from inspect', async () => {
  config.mcp!.servers!.secret = { url: 'https://private.example/path?key=hidden', headers: { Authorization: 'Bearer hidden-token' } };
  const value = JSON.stringify(await service.command('inspect', {}, context));
  expect(value).not.toContain('hidden'); expect(value).not.toContain('private.example');
});

it('rechecks a queued continuation after cancellation or target changes', async () => {
  const goal = await start();
  const ready = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context) as any;
  const input = { conversationId: context.conversationId, expectedTranscriptId: resume.mock.calls[0][0].transcriptId,
    clientMessageId: `mcp-setup:${goal.setupId}`, origin: { type: 'system', source: 'internal' } };
  expect(service.permitsContinuation(input)).toBe(true);
  expect(service.permitsContinuation({ ...input, origin: { type: 'system', source: 'cli' } })).toBe(false);
  await service.command('cancel', { setupId: goal.setupId, expectedVersion: ready.version }, context);
  expect(service.permitsContinuation(input)).toBe(false);
  expect(config.mcp!.servers!.docs).toBeDefined();
});

it('does not resume an old time-sensitive objective after its scope expires', async () => {
  resume.mockResolvedValue(false);
  const goal = await start();
  await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context);
  vi.spyOn(Date, 'now').mockReturnValue(goal.expiresAt + 1);
  await service.resumePending();
  const expired = await service.command('get', { setupId: goal.setupId }, context) as any;
  expect(expired).toMatchObject({ phase: 'blocked', expired: true, errorCode: 'scope_expired' });
  expect(resume).toHaveBeenCalledTimes(1);
});

it('accepts a concurrent reconciliation of the same continuation instead of reporting a false conflict', async () => {
  let release!: (value: boolean) => void;
  resume.mockImplementationOnce(() => new Promise<boolean>(done => { release = done; })).mockResolvedValue(true);
  const goal = await start();
  const advancing = service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await service.resumePending();
  release(true);
  await expect(advancing).resolves.toMatchObject({ phase: 'ready', continuationQueued: true });
  expect(resume.mock.calls.map(call => call[0].id)).toEqual([goal.setupId, goal.setupId]);
});

function weixinContext(peerKind = 'direct') {
  saveWeixinAccount('bot-a', { token: 'fixture-channel-login', userId: 'fixture-bot' });
  config.session.dmScope = 'per-account-channel-peer';
  config.gateway.publicUrl = 'https://setup.example.com';
  config.channels.weixin = { enabled: true, dmPolicy: 'pairing', allowFrom: ['alice@im.wechat'] };
  const session = createConversation({ agentId: 'main', sourceChannel: 'weixin', sourceChatId: 'alice@im.wechat',
    routing: { source: 'weixin', accountId: 'bot-a', peerKind, peerId: 'alice@im.wechat' } });
  return { conversationId: session.key, agentId: 'main', canConfigure: false, canRequestWeixinSetup: true };
}

it('requires exact owner approval before a paired Weixin request can probe or accept credentials', async () => {
  const ctx = weixinContext();
  const goal = await service.command('start', { serverId: 'wechat-docs', url: 'https://data.example.com/mcp', purpose: 'Read my profile' }, ctx) as any;
  expect(goal).toMatchObject({ phase: 'approval_required', returnChannel: 'weixin', interactionPath: `https://setup.example.com/#/mcp-setup/${goal.setupId}` });
  expect(native.probeMcpConnection).not.toHaveBeenCalled();
  await expect(service.interact(goal.setupId, 'token', 'do-not-save', goal.version)).rejects.toThrow('Approve');
  await expect(service.command('set_enabled', {}, ctx)).rejects.toThrow('approval');
  const pending = await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, ctx) as any;
  expect(pending.phase).toBe('approval_required');
  native.probeMcpConnection.mockResolvedValue({ state: 'token_required' });
  const approved = await service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner') as any;
  expect(approved.phase).toBe('token_required');
  expect((await service.interact(goal.setupId, 'get') as any).approval).toMatchObject({ accountId: 'bot-a', peerId: 'alice@im.wechat', endpoint: 'https://data.example.com/mcp' });
  await expect(service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner')).rejects.toThrow('changed');
  expect(config.mcp!.servers![goal.serverId]).toBeUndefined();
});

it('keeps explicit Bearer setup behind exact Weixin owner approval', async () => {
  const ctx = weixinContext();
  const goal = await service.command('start', { serverId: 'docs', url: 'https://fixture.example/mcp', purpose: 'Read', authentication: 'bearer' }, ctx) as any;
  expect(goal.phase).toBe('approval_required');
  await expect(service.interact(goal.setupId, 'token', 'do-not-save', goal.version)).rejects.toThrow('Approve');
  const approved = await service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner') as any;
  expect(approved.phase).toBe('token_required'); expect(native.probeMcpConnection).not.toHaveBeenCalled();
  expect(config.mcp!.servers![goal.serverId]).toBeUndefined();
});

it('rejects unpaired, wildcard, group and forged channel requests without elevating pairing to owner', async () => {
  const ctx = weixinContext();
  const input = { serverId: 'docs', url: 'https://data.example.com/mcp', purpose: 'Read' };
  await expect(service.command('start', input, { ...ctx, canRequestWeixinSetup: false, canConfigure: true })).rejects.toThrow('Weixin');
  config.channels.weixin = { enabled: true, dmPolicy: 'open', allowFrom: ['*'] };
  await expect(service.command('start', input, ctx)).rejects.toThrow('Weixin');
  const group = weixinContext('group');
  await expect(service.command('start', input, group)).rejects.toThrow('Weixin');
  expect(native.probeMcpConnection).not.toHaveBeenCalled();
});

it('rechecks pairing and the public origin before late approval, probes, continuation and delivery', async () => {
  const ctx = weixinContext();
  const goal = await service.command('start', { serverId: 'docs', url: 'https://data.example.com/mcp', purpose: 'Read' }, ctx) as any;
  config.channels.weixin = { enabled: false };
  await expect(service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner')).rejects.toThrow('identity');
  expect((await service.interact(goal.setupId, 'get') as any).phase).toBe('cancelled');
  expect(native.probeMcpConnection).not.toHaveBeenCalled();
});

it('pins public OAuth relay to an approved attempt, rejects duplicates and keeps native redirect validation', async () => {
  const ctx = weixinContext();
  native.probeMcpConnection.mockResolvedValue({ state: 'oauth_required' });
  native.startMcpAuthorization.mockReturnValue({ id: 'native-attempt', state: 'authorizing' });
  native.getMcpAuthorization.mockReturnValue({ id: 'native-attempt', state: 'authorizing' });
  native.submitMcpRedirect.mockReturnValue(true);
  const goal = await service.command('start', { serverId: 'docs', url: 'https://data.example.com/mcp', purpose: 'Read' }, ctx) as any;
  const approved = await service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner') as any;
  const auth = await service.interact(goal.setupId, 'authorize', undefined, approved.version) as any;
  expect(native.startMcpAuthorization.mock.calls[0][4]).toMatchObject({ callbackRelayUrl: `https://setup.example.com/mcp-setup/callback/${goal.setupId}` });
  await expect(service.command('get', { setupId: goal.setupId }, { ...weixinContext(), conversationId: context.conversationId })).rejects.toThrow();
  expect(() => service.relayCallback(goal.setupId, `https://wrong.example/mcp-setup/callback/${goal.setupId}?code=opaque&state=opaque`)).toThrow('Invalid');
  expect(service.relayCallback(goal.setupId, `https://setup.example.com/mcp-setup/callback/${goal.setupId}?code=opaque&state=opaque`)).toBe(`/#/mcp-setup/${goal.setupId}`);
  expect(() => service.relayCallback(goal.setupId, `https://setup.example.com/mcp-setup/callback/${goal.setupId}?code=opaque&state=opaque`)).toThrow('already');
  expect(JSON.stringify(await service.command('get', { setupId: auth.setupId }, ctx))).not.toContain('opaque');
});

it('retries only persisted Weixin result delivery without rerunning the model or source read', async () => {
  const ctx = weixinContext(), deliver = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  service = new McpConversationSetup({ readConfig: () => config, saveConfig: async next => { config = next; return { saved: true }; },
    withConfigLock: operation => operation(), resume, deliver });
  const goal = await service.command('start', { serverId: 'docs', url: 'https://data.example.com/mcp', purpose: 'Read' }, ctx) as any;
  await service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner');
  const input = { conversationId: ctx.conversationId, expectedTranscriptId: resume.mock.calls[0][0].transcriptId,
    clientMessageId: `mcp-setup:${goal.setupId}`, origin: { type: 'system', source: 'internal' }, runId: 'verified-read' };
  await service.completeContinuation(input, 'Actual current data');
  const failed = await service.interact(goal.setupId, 'get') as any;
  expect(failed.replyDelivery).toBe('failed');
  await service.interact(goal.setupId, 'retry_delivery', undefined, failed.version, 'owner');
  expect((await service.interact(goal.setupId, 'get') as any).replyDelivery).toBe('delivered');
  expect(deliver.mock.calls.map(call => call.slice(0, 2))).toEqual(Array(2).fill([{ accountId: 'bot-a', peerId: 'alice@im.wechat', principalId: expect.stringMatching(/^channel:weixin:bot-a:direct:alice@im\.wechat:login:[a-f0-9]{64}$/), origin: 'https://setup.example.com' }, 'Actual current data']));
  expect(resume).toHaveBeenCalledTimes(1);
  await service.completeContinuation(input, 'Duplicate');
  expect(deliver).toHaveBeenCalledTimes(2);
});

it('does not bind a private configuration goal through shared or identity-merged conversation routing', async () => {
  const ctx = weixinContext(); config.session.dmScope = 'main';
  const target = { serverId: 'docs', url: 'https://data.example.com/mcp', purpose: 'Read' };
  await expect(service.command('start', target, ctx)).rejects.toThrow('account-isolated');
  config.session.dmScope = 'per-account-channel-peer'; config.session.identityLinks = { shared: ['weixin:alice@im.wechat'] };
  await expect(service.command('start', target, ctx)).rejects.toThrow('account-isolated');
  expect(native.probeMcpConnection).not.toHaveBeenCalled();
});

it('does not revive a revoked Weixin objective after the same peer is approved again', async () => {
  const ctx = weixinContext();
  const goal = await service.command('start', { serverId: 'docs', url: 'https://data.example.com/mcp', purpose: 'Read' }, ctx) as any;
  service.revokeWeixinRequests('bot-a', 'alice@im.wechat');
  service.reconcileWeixinScopes();
  expect((await service.interact(goal.setupId, 'get') as any).phase).toBe('cancelled');
  await expect(service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner')).rejects.toThrow();
  expect(native.probeMcpConnection).not.toHaveBeenCalled();
});

it('treats an already delivered Weixin result as an idempotent retry even from a stale page', async () => {
  const ctx = weixinContext(), deliver = vi.fn().mockResolvedValue(undefined);
  service = new McpConversationSetup({ readConfig: () => config, saveConfig: async next => { config = next; return { saved: true }; },
    withConfigLock: operation => operation(), resume, deliver });
  const goal = await service.command('start', { serverId: 'docs', url: 'https://data.example.com/mcp', purpose: 'Read' }, ctx) as any;
  await service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner');
  await service.completeContinuation({ conversationId: ctx.conversationId, expectedTranscriptId: resume.mock.calls[0][0].transcriptId,
    clientMessageId: `mcp-setup:${goal.setupId}`, origin: { type: 'system', source: 'internal' }, runId: 'verified-read' }, 'Actual result');
  expect(await service.interact(goal.setupId, 'retry_delivery', undefined, goal.version, 'owner')).toMatchObject({ replyDelivery: 'delivered' });
  expect(deliver).toHaveBeenCalledTimes(1);
});

it('finishes an approved OAuth objective on the host without another browser advance request', async () => {
  const ctx = weixinContext();
  native.probeMcpConnection.mockResolvedValue({ state: 'oauth_required' });
  native.startMcpAuthorization.mockReturnValue({ id: 'native-attempt', state: 'authorizing' });
  native.getMcpAuthorization.mockReturnValue({ id: 'native-attempt', state: 'authorizing' });
  const goal = await service.command('start', { serverId: 'docs', url: 'https://data.example.com/mcp', purpose: 'Read' }, ctx) as any;
  const approved = await service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner') as any;
  await service.interact(goal.setupId, 'authorize', undefined, approved.version);
  native.getMcpAuthorization.mockReturnValue({ id: 'native-attempt', state: 'connected', toolCount: 1 });
  await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
  expect(config.mcp!.servers![goal.serverId].url).toBe('https://data.example.com/mcp');
  expect(await service.interact(goal.setupId, 'get')).toMatchObject({ phase: 'ready', continuationQueued: true });
});

it('assigns collision-free Weixin connection identities without exposing technical naming work to the user', async () => {
  const ctx = weixinContext();
  const request = { serverId: 'reference-data', displayName: '资料服务', url: 'https://one.example/mcp', purpose: 'Read' };
  const first = await service.command('start', request, ctx) as any;
  await service.interact(first.setupId, 'approve', undefined, first.version, 'owner');
  const second = await service.command('start', { ...request, url: 'https://two.example/mcp' }, ctx) as any;
  expect(second.phase).toBe('approval_required');
  expect(second.serverId).not.toBe(first.serverId);
  expect(config.mcp!.servers![first.serverId].url).toBe(request.url);
  expect(config.mcp!.servers![second.serverId]).toBeUndefined();
  expect(await service.command('start', request, ctx)).toMatchObject({ alreadyConfigured: true, serverId: first.serverId });
});

it('aborts native authorization on shutdown but preserves the durable objective for a safe restart recheck', async () => {
  const ctx = weixinContext();
  native.probeMcpConnection.mockResolvedValue({ state: 'oauth_required' });
  native.startMcpAuthorization.mockReturnValue({ id: 'native-attempt', state: 'authorizing' });
  native.getMcpAuthorization.mockReturnValue({ id: 'native-attempt', state: 'authorizing' });
  const goal = await service.command('start', { serverId: 'docs', url: 'https://data.example.com/mcp', purpose: 'Read' }, ctx) as any;
  const approved = await service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner') as any;
  await service.interact(goal.setupId, 'authorize', undefined, approved.version);
  service.dispose();
  expect(native.cancelMcpAuthorization).toHaveBeenCalled();
  service = new McpConversationSetup({ readConfig: () => config, saveConfig: async next => { config = next; return { saved: true }; },
    withConfigLock: operation => operation(), resume });
  expect(await service.interact(goal.setupId, 'get')).toMatchObject({ requiresRecheck: true, phase: 'authorizing' });
  expect(resume).not.toHaveBeenCalled();
});

it('requires owner review for every discovered plan even if a legacy candidate reports trusted', async () => {
  vi.spyOn(McpDiscovery.prototype, 'selected').mockReturnValue({
    id: 'candidate', trusted: true, evidence: [], sources: [{ url: 'https://docs.example/guide', hash: 'fixture' }], purpose: 'Connect only',
    plan: { displayName: 'Any service', url: 'https://data.example.com/mcp', transport: 'streamable-http', authentication: 'none', secretFields: [], objective: 'connect_only' },
  });
  const goal = await service.command('start', { planId: '00000000-0000-4000-8000-000000000000', expectedPlanVersion: 1, serverId: 'discovered', purpose: 'Connect only' }, context) as any;
  expect(goal.phase).toBe('approval_required');
  expect(await service.command('advance', { setupId: goal.setupId, expectedVersion: goal.version }, context)).toMatchObject({ phase: 'approval_required' });
  expect(native.probeMcpConnection).not.toHaveBeenCalled();
  expect(config.mcp!.servers!.discovered).toBeUndefined();
  expect(resume).not.toHaveBeenCalled();
});

it('invalidates an old objective when a channel account label is logged into a different Weixin identity', async () => {
  const ctx = weixinContext();
  const goal = await service.command('start', { serverId: 'docs', url: 'https://data.example.com/mcp', purpose: 'Read' }, ctx) as any;
  saveWeixinAccount('bot-a', { token: 'another-channel-login', userId: 'another-bot' });
  await expect(service.interact(goal.setupId, 'approve', undefined, goal.version, 'owner')).rejects.toThrow('identity');
  saveWeixinAccount('bot-a', { token: 'fixture-channel-login', userId: 'fixture-bot' });
  expect(await service.interact(goal.setupId, 'get')).toMatchObject({ phase: 'cancelled' });
  expect(native.probeMcpConnection).not.toHaveBeenCalled();
});
