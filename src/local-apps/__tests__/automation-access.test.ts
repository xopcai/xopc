import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAppResourceScopesSchema } from '@xopcai/gateway-contract';
import { Hono } from 'hono';
import { registerLocalAppRunStreams } from '../../gateway/hono/routes/local-app-run-streams.js';
import { setGatewayPrincipal } from '../../gateway/security/gateway-principal.js';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { AutomationService } from '../../automations/service/automation-service.js';
import { appendAutomationRunEvent, saveAutomation, saveAutomationRun } from '../../automations/storage/index.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import { CapabilityError, type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { automationConfigurationDigest } from '../capabilities/automation-policy.js';
import { localAppCapabilities } from '../capabilities/runtime.js';
import { validateLocalAppCapabilityContracts } from '../capabilities/contracts.js';

let root: string;
let service: AutomationService;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'local-app-automation-')); resetXopcDatabaseSingletonForTest();
  seedTestDatabase(join(root, 'xopc.db')); openXopcDatabase({ path: join(root, 'xopc.db') });
  service = new AutomationService();
  vi.spyOn(service, 'dispatchQueuedRun').mockImplementation(() => {});
});
afterEach(async () => {
  await service.stop(); vi.restoreAllMocks(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const create = (name: string) => service.create({ name, enabled: true, trigger: { kind: 'manual' },
    action: { kind: 'agent', instruction: 'PRIVATE INSTRUCTION', workingDirectory: '/private/workspace' },
    safety: { mode: 'suggest_only' }, delivery: { notificationPolicy: 'none', destinations: [] } });
  const automation = await create('Approved'); const other = await create('Other');
  const dispatcher = createProductDispatcher(undefined, { getAutomations: () => service });
  const caller: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['gateway.admin'], authorize: () => true };
  const bindings = dispatcher.list({ ...caller, surface: 'extension' }).map(({ id, majorVersion, descriptorDigest }) => ({ id, majorVersion, descriptorDigest }));
  const scopes = LocalAppResourceScopesSchema.parse({
    automationsRead: { mode: 'selected', ids: [automation.id] },
    automationsRun: { mode: 'selected', approvals: [{ id: automation.id, configurationDigest: automationConfigurationDigest(automation), authority: { model: true, tools: false, dataWrite: false, externalSend: false, expiresAt: Date.now() + 3600000, maxRuns: 10, maxCostMicrousd: 1000000 } }] },
  });
  let granted = true;
  const apps = { getCapabilityAccess: () => {
    if (!granted) throw new CapabilityError('FORBIDDEN', 'Revoked');
    return { releaseId: 'release', grantRevision: '00000000-0000-4000-8000-000000000001', bindings, resourceScopes: scopes };
  } };
  const runtime = (extensionId = 'app', context = caller) => localAppCapabilities(apps, dispatcher, extensionId, 'a'.repeat(64), context);
  const call = async (command: string, input: unknown = {}, key = crypto.randomUUID(), extensionId = 'app', context = caller) => {
    const id = `xopc.automations.${command}`;
    return runtime(extensionId, context).call(id, { ...dispatcher.describe(id, { ...context, surface: 'extension' }), input, idempotencyKey: key });
  };
  return { apps, automation, other, scopes, call, dispatcher, bindings, runtime, caller, revoke: () => { granted = false; } };
}

describe('Local App automation execution', () => {
  it('preserves a terminal notification that arrives during initial snapshot construction', async () => {
    const f = await fixture();
    const submitted = await f.call('run', { id: f.automation.id }) as { data: { run: { id: string } } };
    const original = service.getRun.bind(service); let reads = 0;
    vi.spyOn(service, 'getRun').mockImplementation(async id => {
      const run = await original(id);
      if (++reads === 3 && run) saveAutomationRun({ ...run, status: 'succeeded', summary: 'Terminal result' });
      return run;
    });
    const app = new Hono();
    app.use('*', async (context, next) => { setGatewayPrincipal(context, { kind: 'token', principalId: 'owner', scopes: ['gateway.admin'] }); await next(); });
    registerLocalAppRunStreams(app, { service: { localApps: f.apps, getResolvedAuth: () => ({ mode: 'token', token: 'fixture' }) } } as never, f.dispatcher);
    const response = await app.request(`/api/local-app-capabilities/app/runs/${submitted.data.run.id}/events?manifestDigest=${'a'.repeat(64)}&grantRevision=00000000-0000-4000-8000-000000000001`);
    const text = await response.text();
    expect(text).toContain('"status":"succeeded"');
    expect(text).toContain('Terminal result');
  });
  it('streams an authorized snapshot and terminates the stream on revocation', async () => {
    const f = await fixture();
    const submitted = await f.call('run', { id: f.automation.id }) as { data: { run: { id: string } } };
    const app = new Hono();
    app.use('*', async (context, next) => {
      setGatewayPrincipal(context, { kind: 'token', principalId: 'owner', scopes: ['gateway.admin'] }); await next();
    });
    registerLocalAppRunStreams(app, { service: { localApps: f.apps, getResolvedAuth: () => ({ mode: 'token', token: 'fixture' }) } } as never, f.dispatcher);
    const path = `/api/local-app-capabilities/app/runs/${submitted.data.run.id}/events?manifestDigest=${'a'.repeat(64)}&grantRevision=00000000-0000-4000-8000-000000000001`;
    const response = await app.request(path); expect(response.status).toBe(200);
    const reader = response.body!.getReader(); const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain('event: snapshot');
    f.revoke();
    let ended = '';
    while (!ended.includes('event: ended')) { const next = await reader.read(); if (next.done) break; ended += decoder.decode(next.value); }
    expect(ended).toContain('event: ended');
    await reader.cancel();
    expect((await app.request(path)).status).toBe(403);
  });
  it('separates file-result writes from external result delivery', async () => {
    const f = await fixture();
    if (f.scopes.automationsRun.mode !== 'selected') throw new Error('Missing approval');
    const approval = f.scopes.automationsRun.approvals[0];
    const file = { ...f.automation, delivery: { notificationPolicy: 'none' as const,
      destinations: [{ key: 'file', kind: 'file' as const, targetId: 'fixture', pathTemplate: 'report.md' }] } };
    saveAutomation(file); approval.configurationDigest = automationConfigurationDigest(file);
    approval.authority.externalSend = true;
    await expect(f.call('run', { id: file.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    approval.authority.externalSend = false; approval.authority.dataWrite = true;
    const run = await f.call('run', { id: file.id }) as { data: { run: { id: string } } };
    await f.call('cancel', { id: run.data.run.id });
    const external = { ...file, delivery: { notificationPolicy: 'none' as const,
      destinations: [{ key: 'webhook', kind: 'webhook' as const, endpoint: 'https://example.invalid/result', secretId: 'fixture' }] } };
    saveAutomation(external); approval.configurationDigest = automationConfigurationDigest(external);
    await expect(f.call('run', { id: external.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    approval.authority.externalSend = true;
    await expect(f.call('run', { id: external.id })).resolves.toMatchObject({ status: 'succeeded' });
  });
  it('filters recoverable run history before pagination and strips event payloads', async () => {
    const f = await fixture();
    const owned: string[] = [];
    for (let i = 0; i < 2; i++) {
      const submitted = await f.call('run', { id: f.automation.id }) as { data: { run: { id: string } } };
      owned.push(submitted.data.run.id); await f.call('cancel', { id: submitted.data.run.id });
    }
    const foreign = service.queueRunAtomically(f.automation.id); await service.cancelRun(foreign.id);
    const first = (await f.call('history', { limit: 1 })).data as { items: Array<{ id: string }>; nextCursor: string; hasMore: boolean };
    expect(first.items).toHaveLength(1); expect(first.hasMore).toBe(true); expect(owned).toContain(first.items[0].id);
    const second = (await f.call('history', { limit: 1, cursor: first.nextCursor })).data as { items: Array<{ id: string }>; hasMore: boolean };
    expect(second.items).toHaveLength(1); expect(second.hasMore).toBe(false); expect(second.items[0].id).not.toBe(first.items[0].id);
    expect((await f.call('history', {}, 'other', 'another-app')).data).toMatchObject({ items: [], hasMore: false });
    appendAutomationRunEvent({ id: crypto.randomUUID(), runId: owned[0], automationId: f.automation.id,
      type: 'action.failed', message: 'SECRET MESSAGE', data: { secret: 'SECRET PAYLOAD' }, createdAtMs: Date.now() });
    const events = (await f.call('run_events', { id: owned[0] })).data;
    expect(JSON.stringify(events)).not.toContain('SECRET');
    await expect(f.call('run_events', { id: foreign.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('enforces expiry and lifetime run counts without charging receipt replay', async () => {
    const f = await fixture();
    if (f.scopes.automationsRun.mode !== 'selected') throw new Error('Missing fixture approval');
    const authority = f.scopes.automationsRun.approvals[0].authority; authority.maxRuns = 1;
    const first = await f.call('run', { id: f.automation.id }, 'single') as { data: { run: { id: string } } };
    await f.call('cancel', { id: first.data.run.id });
    expect(await f.call('run', { id: f.automation.id }, 'single')).toEqual(first);
    await expect(f.call('run', { id: f.automation.id }, 'over-limit')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    authority.expiresAt = Date.now() - 1;
    await expect(f.call('run', { id: f.automation.id }, 'single')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('publishes pinned automation capabilities, with narrow data and no implicit execution', async () => {
    const f = await fixture();
    expect(f.bindings.filter(item => item.id.startsWith('xopc.automations.')).map(item => item.id).sort()).toEqual([
      'xopc.automations.cancel', 'xopc.automations.get', 'xopc.automations.get_proposal', 'xopc.automations.get_run',
      'xopc.automations.history', 'xopc.automations.list', 'xopc.automations.propose', 'xopc.automations.run', 'xopc.automations.run_events', 'xopc.automations.simulate',
    ]);
    expect(() => validateLocalAppCapabilityContracts(f.bindings)).not.toThrow();
    expect((await f.call('list')).data).toMatchObject({ items: [{ id: f.automation.id }] });
    const detail = (await f.call('get', { id: f.automation.id })).data;
    expect(detail).not.toHaveProperty('automation.action'); expect(detail).not.toHaveProperty('automation.delivery');
    await expect(f.call('get', { id: f.other.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.scopes.automationsRun = { mode: 'none' };
    await expect(f.call('run', { id: f.automation.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(service.dispatchQueuedRun).not.toHaveBeenCalled();
    await expect(f.call('list', { resourceRestriction: { mode: 'workspace' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('queues exactly once, records app ownership and keeps execution inputs host-owned', async () => {
    const f = await fixture();
    const first = await f.call('run', { id: f.automation.id }, 'once') as { data: { run: { id: string } } };
    expect(await f.call('run', { id: f.automation.id }, 'once')).toEqual(first);
    expect((await service.listRuns({ automationId: f.automation.id })).length).toBe(1);
    expect(first.data).not.toHaveProperty('automation.action'); expect(first.data.run).not.toHaveProperty('actionSnapshot');
    expect(new DurableState('local-app-automation-runs', 'app').get(first.data.run.id)).toEqual({ automationId: f.automation.id });
    expect(new DurableState<{ count: number }>('local-app-automation-budget', 'app').get('hour')?.count).toBe(1);
    for (const extra of [{ action: { kind: 'agent', instruction: 'escalate' } }, { agentId: 'admin' }, { payload: { instruction: 'escalate' } }]) {
      await expect(f.call('run', { id: f.automation.id, ...extra })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    const id = first.data.run.id;
    const run = (await service.getRun(id))!;
    saveAutomationRun({ ...run, status: 'succeeded', summary: 'Result', conversationId: crypto.randomUUID() });
    expect((await f.call('get_run', { id })).data).toMatchObject({ run: { summary: 'Result' } });
    expect((await f.call('get_run', { id })).data).not.toHaveProperty('run.conversationId');
    await expect(f.call('get_run', { id }, 'other', 'another-app')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.call('cancel', { id }, 'other', 'another-app')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('invalidates changed configurations before execution or replay, but permits stopping owned work', async () => {
    const f = await fixture();
    const first = await f.call('run', { id: f.automation.id }, 'original') as { data: { run: { id: string } } };
    saveAutomation({ ...f.automation, action: { kind: 'agent', instruction: 'CHANGED' } });
    await expect(f.call('run', { id: f.automation.id }, 'original')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.call('run', { id: f.automation.id }, 'new')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await f.call('cancel', { id: first.data.run.id })).data).toMatchObject({ cancelled: true, confirmed: true });
    expect((await service.listRuns({ automationId: f.automation.id })).length).toBe(1);
  });

  it('keeps read and run approvals independent and bounds submissions persistently', async () => {
    const f = await fixture(); f.scopes.automationsRead = { mode: 'none' };
    const result = await f.call('run', { id: f.automation.id }) as { data: { run: { id: string } } };
    await expect(f.call('get_run', { id: result.data.run.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await f.call('cancel', { id: result.data.run.id });
    new DurableState('local-app-automation-budget', 'app').set('hour', { start: Date.now(), count: 20 });
    await expect(f.call('run', { id: f.automation.id })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const before = (await service.listRuns({ automationId: f.automation.id })).length;
    f.revoke();
    await expect(f.call('run', { id: f.automation.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await service.listRuns({ automationId: f.automation.id })).length).toBe(before);
  });

  it('withholds long-poll results when application authorization is revoked', async () => {
    const f = await fixture();
    const submitted = await f.call('run', { id: f.automation.id }) as { data: { run: { id: string } } };
    const getRun = vi.spyOn(service, 'getRun');
    const pending = f.call('get_run', { id: submitted.data.run.id, waitMs: 5000 });
    const withheld = expect(pending).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await vi.waitFor(() => expect(getRun).toHaveBeenCalled());
    f.revoke();
    await withheld;
  });

  it('denies other records, narrowed callers and disabled automations', async () => {
    const f = await fixture();
    await expect(f.call('run', { id: f.other.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.call('run', { id: f.automation.id }, 'narrow', 'app', { ...f.caller, scopes: ['automations.read'] }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    saveAutomation({ ...f.automation, enabled: false });
    await expect(f.call('run', { id: f.automation.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
