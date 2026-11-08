import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LocalAppResourceScopesSchema } from '@xopcai/gateway-contract';
import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { AutomationService } from '../../automations/service/automation-service.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import { CapabilityError, type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { localAppCapabilities } from '../capabilities/runtime.js';
import { readAutomationProposal, resolveAutomationProposal } from '../automation-proposals.js';

let root: string, service: AutomationService;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'app-proposals-')); resetXopcDatabaseSingletonForTest();
  seedTestDatabase(join(root, 'xopc.db')); openXopcDatabase({ path: join(root, 'xopc.db') }); service = new AutomationService();
});
afterEach(async () => { await service.stop(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(root, { recursive: true, force: true }); });
const definition = { name: 'Proposed', enabled: true, trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'Review' },
  safety: { mode: 'suggest_only' }, delivery: { notificationPolicy: 'none', destinations: [] } };
function fixture() {
  const dispatcher = createProductDispatcher(undefined, { getAutomations: () => service });
  const caller: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['gateway.admin'], authorize: () => true };
  const bindings = dispatcher.list({ ...caller, surface: 'extension' }).map(({ id, majorVersion, descriptorDigest }) => ({ id, majorVersion, descriptorDigest }));
  const scopes = LocalAppResourceScopesSchema.parse({ automationProposals: true, automationsRead: { mode: 'workspace' } });
  let current = true;
  const apps = { getCapabilityAccess: () => {
    if (!current) throw new CapabilityError('FORBIDDEN', 'Revoked');
    return { releaseId: 'release', grantRevision: 'revision', resourceScopes: scopes, bindings };
  } };
  const call = async (command: string, input: unknown, key = crypto.randomUUID(), extensionId = 'app') => {
    const id = `xopc.automations.${command}`;
    return localAppCapabilities(apps, dispatcher, extensionId, 'a'.repeat(64), caller).call(id,
      { ...dispatcher.describe(id, { ...caller, surface: 'extension' }), input, idempotencyKey: key });
  };
  const propose = async (input: unknown = { kind: 'create', definition }, key?: string) => (await call('propose', input, key)).data as { id: string };
  const resolve = (id: string, approve = true, enable = false, digest = readAutomationProposal('app', id).digest) =>
    resolveAutomationProposal(apps, dispatcher, 'app', id, { digest, approve, enable }, caller);
  return { apps, dispatcher, caller, scopes, call, propose, resolve, revoke: () => { current = false; } };
}
it('simulates and persists immutable proposals without creating or executing work', async () => {
  const f = fixture();
  expect((await f.call('simulate', definition)).data).toHaveProperty('simulation.actionSummary');
  const proposal = await f.propose(undefined, 'same-intent');
  expect(await f.propose(undefined, 'same-intent')).toEqual(proposal);
  expect(await service.list()).toEqual([]);
  expect((await f.call('get_proposal', { id: proposal.id })).data).toMatchObject({ status: 'pending' });
  await expect(f.call('get_proposal', { id: proposal.id }, 'other', 'other-app')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  f.scopes.automationProposals = false;
  await expect(f.propose()).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('requires an exact host review and defaults adoption to disabled, with idempotent approval', async () => {
  const f = fixture(); const proposal = await f.propose();
  await expect(f.resolve(proposal.id, true, false, 'f'.repeat(64))).rejects.toMatchObject({ code: 'CONTRACT_CHANGED' });
  const approved = await f.resolve(proposal.id);
  expect(approved).toMatchObject({ status: 'approved' });
  expect((await service.get(approved.automationId!))?.enabled).toBe(false);
  expect(await f.resolve(proposal.id)).toEqual(approved);
  expect(await service.list()).toHaveLength(1);
});
it('rejects proposals without applying changes and denies revoked authority', async () => {
  const f = fixture(); const rejected = await f.propose();
  expect(await f.resolve(rejected.id, false)).toMatchObject({ status: 'rejected' });
  expect(await f.resolve(rejected.id)).toMatchObject({ status: 'rejected' });
  const revoked = await f.propose(); f.revoke();
  await expect(f.resolve(revoked.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await service.list()).toHaveLength(0);
});
it('checks update revisions and read scope before applying an app change', async () => {
  const f = fixture(); const target = await service.create(definition as never);
  const proposal = await f.propose({ kind: 'update', id: target.id, expectedRevision: target.updatedAtMs, patch: { name: 'Reviewed edit' } });
  f.scopes.automationsRead = { mode: 'none' };
  await expect(f.resolve(proposal.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  f.scopes.automationsRead = { mode: 'workspace' };
  await f.resolve(proposal.id);
  expect(await service.get(target.id)).toMatchObject({ name: 'Reviewed edit', enabled: false });
  await expect(f.propose({ kind: 'update', id: target.id, expectedRevision: target.updatedAtMs, patch: { name: 'Stale' } })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
});
it('reconciles a committed update after a crash before the proposal status write', async () => {
  const f = fixture(); const target = await service.create(definition as never);
  const proposal = await f.propose({ kind: 'update', id: target.id, expectedRevision: target.updatedAtMs, patch: { name: 'Once' } });
  const original = readAutomationProposal('app', proposal.id);
  const result = await f.resolve(proposal.id);
  new DurableState('local-app-automation-proposals').set(proposal.id, { ...original, decision: { approve: true, enable: false } });
  expect(await f.resolve(proposal.id)).toEqual(result);
  expect(await service.list()).toHaveLength(1);
  expect(await service.get(target.id)).toMatchObject({ name: 'Once' });
});
