import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { CliToolProvider } from '../../../agent/external-tools/cliProvider.js';
import { externalToolRef } from '../../../agent/external-tools/refs.js';
import { closeXopcDatabase, decideConnectorApproval, getConnectorAccount, openXopcDatabase, resetXopcDatabaseSingletonForTest, upsertConnectorInstallation } from '../../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { getConnectorDefinition } from '../../catalog.js';
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
  const definition = { ...getConnectorDefinition('feishu-workspace')!, id: 'contract-test', runtime: { type: 'cli' as const, adapterId: adapter.id, adapterVersion: '1', binaryVersion: '1.0.0' } };
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
});
