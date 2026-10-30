import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { ExternalToolService } from '../../../agent/external-tools/service.js';
import { scopePersonalRequestProvider } from '../../../agent/external-tools/personal-request-scope.js';
import { withExternalReadPolicy } from '../../../agent/external-tools/read-policy.js';
import type { PersonalRequest } from '../../../personal-agent/request-repository.js';
import { CliToolProvider } from '../../../agent/external-tools/cliProvider.js';
import { externalToolRef } from '../../../agent/external-tools/refs.js';
import { closeXopcDatabase, decideConnectorApproval, getConnectorAccount, openXopcDatabase, resetXopcDatabaseSingletonForTest, upsertConnectorInstallation } from '../../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { fixtureDefinition } from './fixture-adapter.js';
import { registerCliAdapter } from '../adapterRegistry.js';
import { commitCliIdentity, createCliAuthorization, updateCliAuthorization } from '../store.js';
import type { CliAdapter } from '../types.js';
import * as cliRuntime from '../runtime.js';

vi.mock('../installer.js', () => ({ verifyInstalledCli: async () => process.execPath }));
const adapter: CliAdapter = {
  id: 'contract-test', version: '1', binaryVersion: '1.0.0', executable: 'node', distributions: {}, configEnvironment: 'CONTRACT_CONFIG',
  curatedActions: { 'records.read': 'read', 'records.create': 'write' },
  schemaArgs: () => ['-e', 'console.log("{}")'],
  decodeSchema: id => ({ id, description: id, scope: id.endsWith('read') ? 'read' : 'write', requiredScopes: [], revision: '1', inputSchema: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' } }, required: ['title'] } }),
  actionArgs: (_action, input) => input.title === 'lost-result' ? ['-e', 'console.log("not-json")']
    : input.title === 'partial-failure' ? ['-e', 'console.log("{}"); process.exit(1)'] : ['-e', 'console.log(process.argv[1])', JSON.stringify(input)],
  decodeResult: output => JSON.parse(output.stdout), statusArgs: ['-e', 'console.log("verified")'],
  decodeIdentity: output => { if (output.stdout.trim() !== 'verified') throw new Error('Unverified'); return { key: 'user', label: 'Test', scopes: [], identity: { name: 'Test' } }; },
  authorizationSteps: [],
};
registerCliAdapter(adapter);
let directory: string;
let provider: CliToolProvider;
let accountId: string;
let config: Config;
const read = externalToolRef('cli', 'contract-test', 'records.read');
const write = externalToolRef('cli', 'contract-test', 'records.create');
const execution = { toolCallId: 'test-call' };
const parse = (result: Awaited<ReturnType<CliToolProvider['execute']>>) => JSON.parse((result.content[0] as { text: string }).text);
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cli-execution-')); vi.stubEnv('XOPC_STATE_DIR', directory);
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'test.db') });
  const definition = { ...fixtureDefinition, id: 'contract-test', runtime: { type: 'cli' as const, adapterId: adapter.id, adapterVersion: '1', binaryVersion: '1.0.0' } };
  config = { connectors: { instances: { 'contract-test': { runtime: definition.runtime, xopcConnector: { managed: true, connectorId: definition.id, definition, enabled: true } } } } } as unknown as Config;
  upsertConnectorInstallation({ id: 'contract-test-local-owner', connectorId: 'contract-test', principalId: 'local-owner', enabled: true, allowedAgentIds: [], maxScope: 'write', confirmationPolicy: 'writes', selectedAccountIds: null });
  const attempt = createCliAuthorization('contract-test', 'contract-test'); updateCliAuthorization(attempt.id, { phase: 'verifying' });
  accountId = commitCliIdentity(attempt, { key: 'user', label: 'Test', scopes: [], identity: { name: 'Test' } });
  provider = new CliToolProvider({ getConfig: () => config, getCurrentContext: () => null });
});
afterEach(() => { vi.restoreAllMocks(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

describe('generic CLI provider contract', () => {
  it('runs a third adapter through discovery, schema, identity and execution without provider branches', async () => {
    expect(await provider.search('records')).toHaveLength(2);
    expect(await provider.describe(read)).toMatchObject({ batchRead: true });
    expect(parse(await provider.execute(read, { title: 'literal $(command)', xopcExportResult: true }, undefined, execution))).toMatchObject({ outcome: 'success', accountId, artifact: expect.stringContaining('/artifact'), data: { title: 'literal $(command)' } });
  });
  it('binds approval to exact arguments and consumes it only once', async () => {
    const pending = parse(await provider.execute(write, { title: 'meeting' }, undefined, execution));
    expect(pending.status).toBe('confirmation_required');
    decideConnectorApproval(pending.approvalId, 'approved');
    expect(parse(await provider.execute(write, { title: 'changed' }, pending.approvalId, execution))).toMatchObject({ outcome: 'failed' });
    const accepted = parse(await provider.execute(write, { title: 'meeting' }, pending.approvalId, execution));
    expect(accepted).toMatchObject({ outcome: 'success' });
    expect(parse(await provider.execute(write, { title: 'meeting' }, pending.approvalId, { toolCallId: 'retry-call' }))).toEqual(accepted);
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM connector_cli_executions').get()).toMatchObject({ n: 1 });
  });
  it('serializes duplicate approvals and rechecks revoked policy before spawning', async () => {
    const pending = parse(await provider.execute(write, { title: 'one' }, undefined, execution));
    decideConnectorApproval(pending.approvalId, 'approved');
    const results = await Promise.allSettled([provider.execute(write, { title: 'one' }, pending.approvalId, execution), provider.execute(write, { title: 'one' }, pending.approvalId, execution)]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(value => value.status === 'rejected')).toMatchObject({ reason: { code: 'IN_PROGRESS' } });
    const second = parse(await provider.execute(write, { title: 'two' }, undefined, execution));
    decideConnectorApproval(second.approvalId, 'approved');
    const active = provider.execute(write, { title: 'two' }, second.approvalId, execution);
    getSqliteDatabase().prepare("UPDATE connector_installations SET max_scope = 'read'").run();
    await expect(active).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAVAILABLE/) });
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM connector_cli_executions').get()).toMatchObject({ n: 1 });
  });
  it('records uncertain writes and does not reuse their approval', async () => {
    const pending = parse(await provider.execute(write, { title: 'lost-result' }, undefined, execution));
    decideConnectorApproval(pending.approvalId, 'approved');
    await expect(provider.execute(write, { title: 'lost-result' }, pending.approvalId, execution)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', operationId: expect.any(String) });
    expect(getSqliteDatabase().prepare('SELECT status FROM connector_cli_executions').get()).toMatchObject({ status: 'unknown' });
    await expect(provider.execute(write, { title: 'lost-result' }, pending.approvalId, execution)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM connector_cli_executions').get()).toMatchObject({ n: 1 });
  });
  it('invalidates approval after reconnecting the same account', async () => {
    const pending = parse(await provider.execute(write, { title: 'meeting' }, undefined, execution));
    decideConnectorApproval(pending.approvalId, 'approved');
    const attempt = createCliAuthorization('contract-test', 'contract-test', accountId); updateCliAuthorization(attempt.id, { phase: 'verifying' });
    commitCliIdentity(attempt, { key: 'user', label: 'Test', scopes: [], identity: { name: 'Test' } });
    expect(getConnectorAccount(accountId)?.currentConnectionId).toBeDefined();
    expect(parse(await provider.execute(write, { title: 'meeting' }, pending.approvalId, execution))).toMatchObject({ outcome: 'failed' });
  });

  it('does not interpret a nonzero exit as proof that no remote effect occurred', async () => {
    const pending = parse(await provider.execute(write, { title: 'partial-failure' }, undefined, execution));
    decideConnectorApproval(pending.approvalId, 'approved');
    await expect(provider.execute(write, { title: 'partial-failure' }, pending.approvalId, execution)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(getSqliteDatabase().prepare('SELECT status FROM connector_cli_executions').get()).toMatchObject({ status: 'unknown' });
    expect(getSqliteDatabase().prepare('SELECT state FROM capability_operations').get()).toMatchObject({ state: 'unknown' });
  });

  it('replays a committed write after reopening and still rejects revoked access', async () => {
    const pending = parse(await provider.execute(write, { title: 'durable' }, undefined, execution));
    decideConnectorApproval(pending.approvalId, 'approved');
    const first = parse(await provider.execute(write, { title: 'durable' }, pending.approvalId, execution));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'test.db') });
    expect(parse(await provider.execute(write, { title: 'durable' }, pending.approvalId, { toolCallId: 'after-restart' }))).toEqual(first);
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM connector_cli_executions').get()).toMatchObject({ n: 1 });
    getSqliteDatabase().prepare("UPDATE connector_installations SET max_scope = 'read'").run();
    await expect(provider.execute(write, { title: 'durable' }, pending.approvalId, execution)).rejects.toThrow('scope');
  });

  it('binds approval to the complete contract even when a provider forgets to bump its revision', async () => {
    const pending = parse(await provider.execute(write, { title: 'contract' }, undefined, execution));
    decideConnectorApproval(pending.approvalId, 'approved');
    const describe = cliRuntime.describeCliAction;
    vi.spyOn(cliRuntime, 'describeCliAction').mockImplementationOnce(async (...args) => {
      const action = await describe(...args);
      return { ...action, description: 'Changed semantics at the same revision' };
    });
    expect(parse(await provider.execute(write, { title: 'contract' }, pending.approvalId, execution))).toMatchObject({ outcome: 'failed' });
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM connector_cli_executions').get()).toMatchObject({ n: 0 });
  });

  it('deduplicates unconfirmed-policy writes by logical call identity, not by arguments', async () => {
    getSqliteDatabase().prepare("UPDATE connector_installations SET confirmation_policy = 'never'").run();
    const first = parse(await provider.execute(write, { title: 'repeatable' }, undefined, execution));
    expect(parse(await provider.execute(write, { title: 'repeatable' }, undefined, execution))).toEqual(first);
    await expect(provider.execute(write, { title: 'changed' }, undefined, execution)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(parse(await provider.execute(write, { title: 'repeatable' }, undefined, { toolCallId: 'new-intent' }))).toMatchObject({ outcome: 'success' });
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM connector_cli_executions').get()).toMatchObject({ n: 2 });
  });
  it('does not substitute an unavailable selected account and validates input before execution', async () => {
    expect(parse(await provider.execute(read, { title: 'x', xopcAccountId: 'other' }, undefined, execution))).toMatchObject({ status: 'account_selection_required' });
    await expect(provider.execute(read, { command: 'danger' }, undefined, execution)).rejects.toThrow('Invalid action input');
  });

  it('rechecks the host authorization callback immediately before spawning a CLI operation', async () => {
    const service = new ExternalToolService([provider]);
    const descriptor = (await service.describe([read])).tools[0]!;
    let authorized = true;
    const decodeIdentity = adapter.decodeIdentity;
    vi.spyOn(adapter, 'decodeIdentity').mockImplementationOnce(output => {
      const identity = decodeIdentity(output);
      authorized = false;
      return identity;
    });
    const authorize = vi.fn(() => { if (!authorized) throw new Error('Personal request owner access revoked'); });
    const output = await service.execute({ toolRef: read, revision: descriptor.revision, personalReadOnly: true,
      arguments: { title: 'must-not-run', xopcAccountId: accountId }, context: { toolCallId: 'revoke-before-spawn', authorize } });
    expect(parse(output)).toMatchObject({ outcome: 'failed', error: { message: 'Personal request owner access revoked' } });
    expect(authorize.mock.results.at(-1)?.type).toBe('throw');
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM connector_cli_executions').get()).toMatchObject({ n: 0 });
  });

  it('rejects host revocation during asynchronous CLI schema discovery', async () => {
    const service = new ExternalToolService([provider]);
    const descriptor = (await service.describe([read])).tools[0]!;
    let revoked = false;
    let lookups = 0;
    const original = cliRuntime.describeCliAction;
    vi.spyOn(cliRuntime, 'describeCliAction').mockImplementation(async (...args) => {
      const action = await original(...args);
      if (++lookups === 2) revoked = true;
      return action;
    });
    await expect(service.execute({ toolRef: read, revision: descriptor.revision, personalReadOnly: true,
      arguments: { title: 'schema-revoke', xopcAccountId: accountId }, context: { toolCallId: 'schema-revoke',
        authorize: () => { if (revoked) throw new Error('Personal request no longer active'); } } })).rejects.toThrow('no longer active');
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM connector_cli_executions').get()).toMatchObject({ n: 0 });
  });

  it('pins worker discovery and schema lookup to the selected account through every policy adapter', async () => {
    const attempt = createCliAuthorization('contract-test', 'contract-test');
    updateCliAuthorization(attempt.id, { phase: 'verifying' });
    const foreignAccountId = commitCliIdentity(attempt, { key: 'foreign', label: 'Other account', scopes: [], identity: { name: 'Other' } });
    getSqliteDatabase().prepare('UPDATE connector_connections SET is_default = 1 WHERE account_id = ?').run(foreignAccountId);
    const request = { requestId: 'worker-request', connectorId: 'contract-test', accountId } as PersonalRequest;
    const scoped = scopePersonalRequestProvider(withExternalReadPolicy(provider, () => undefined), () => request, () => config);
    const service = new ExternalToolService([scoped]);
    const original = cliRuntime.describeCliAction;
    const lookup = vi.spyOn(cliRuntime, 'describeCliAction').mockImplementation(async (...args) => {
      const action = await original(...args);
      return args[2].accountId === accountId ? action : { ...action,
        inputSchema: { type: 'object', properties: { foreignOnly: { type: 'string' } }, required: ['foreignOnly'] } };
    });
    expect((await service.search({ query: 'records' })).tools.map(tool => tool.toolRef)).toEqual([read]);
    const descriptor = (await service.describe([read])).tools[0]!;
    expect(descriptor.inputSchema).toMatchObject({ required: expect.arrayContaining(['title', 'xopcAccountId']),
      properties: { xopcAccountId: { const: accountId } } });
    expect(lookup.mock.calls.every(args => args[2].accountId === accountId)).toBe(true);
    await expect(provider.describe(read, { connectorId: 'contract-test', accountId: 'missing' })).resolves.toBeUndefined();
    expect(await provider.search('records', { connectorId: 'contract-test', accountId: 'missing' })).toEqual([]);
    const output = await service.execute({ toolRef: read, revision: descriptor.revision, personalReadOnly: true,
      arguments: { title: 'selected-account', xopcAccountId: accountId }, context: { toolCallId: 'pinned-account' } });
    expect(parse(output)).toMatchObject({ outcome: 'success', accountId });
    await expect(service.execute({ toolRef: read, revision: descriptor.revision, personalReadOnly: true,
      arguments: { title: 'foreign-account', xopcAccountId: foreignAccountId }, context: { toolCallId: 'wrong-account' } })).rejects.toThrow('Arguments do not match');
  });

  it('rejects a worker revision after reconnect and accepts a freshly described contract', async () => {
    const request = { requestId: 'worker-request', connectorId: 'contract-test', accountId } as PersonalRequest;
    const service = new ExternalToolService([scopePersonalRequestProvider(provider, () => request, () => config)]);
    const old = (await service.describe([read])).tools[0]!;
    const attempt = createCliAuthorization('contract-test', 'contract-test', accountId);
    updateCliAuthorization(attempt.id, { phase: 'verifying' });
    commitCliIdentity(attempt, { key: 'user', label: 'Test', scopes: [], identity: { name: 'Test' } });
    const execute = (revision: string) => service.execute({ toolRef: read, revision, personalReadOnly: true,
      arguments: { title: 'after-reconnect', xopcAccountId: accountId }, context: { toolCallId: 'reconnect-read' } });
    await expect(execute(old.revision)).rejects.toThrow('Tool contract changed');
    const fresh = (await service.describe([read])).tools[0]!;
    expect(fresh.revision).not.toBe(old.revision);
    expect(parse(await execute(fresh.revision))).toMatchObject({ outcome: 'success', accountId });
  });

  it('rejects a contract change during the second CLI schema lookup before execution', async () => {
    const request = { requestId: 'worker-request', connectorId: 'contract-test', accountId } as PersonalRequest;
    const service = new ExternalToolService([scopePersonalRequestProvider(provider, () => request, () => config)]);
    const descriptor = (await service.describe([read])).tools[0]!;
    const original = cliRuntime.describeCliAction;
    let lookups = 0;
    vi.spyOn(cliRuntime, 'describeCliAction').mockImplementation(async (...args) => {
      const action = await original(...args);
      return ++lookups === 2 ? { ...action, description: 'Changed operation semantics' } : action;
    });
    await expect(service.execute({ toolRef: read, revision: descriptor.revision, personalReadOnly: true,
      arguments: { title: 'stale-contract', xopcAccountId: accountId }, context: { toolCallId: 'schema-race' } })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM connector_cli_executions').get()).toMatchObject({ n: 0 });
  });


  it('never promotes a CLI write into a Personal worker read via batch configuration', async () => {
    getSqliteDatabase().prepare("UPDATE connector_installations SET confirmation_policy = 'never'").run();
    const wrapped = withExternalReadPolicy(provider, () => ({ mode: 'allow', readOnly: true }));
    const service = new ExternalToolService([wrapped]);
    const descriptor = (await service.describe([write])).tools[0]!;
    expect(descriptor).toMatchObject({ readOnly: false, batchRead: false });
    const call = { toolRef: write, revision: descriptor.revision, arguments: { title: 'forbidden-worker-write', xopcAccountId: accountId },
      context: { toolCallId: 'worker-write' } };
    await expect(service.execute({ ...call, personalReadOnly: true })).rejects.toThrow('no host-curated read-only contract');
    await expect(service.execute({ ...call, readOnly: true })).rejects.toThrow('not approved for batch reads');
    const request = { requestId: 'worker-request', connectorId: 'contract-test', accountId } as PersonalRequest;
    const scoped = new ExternalToolService([scopePersonalRequestProvider(wrapped, () => request, () => config)]);
    expect((await scoped.search({ query: 'records' })).tools.map(tool => tool.toolRef)).toEqual([read]);
    expect((await scoped.describe([write])).notFound).toEqual([write]);
    await expect(scoped.execute({ ...call, personalReadOnly: true })).rejects.toThrow('unavailable');
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM connector_cli_executions').get()).toMatchObject({ n: 0 });
  });

});
