import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTestDatabase } from '../../../storage/sqlite/__tests__/test-database.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { upsertConnectorConnection, upsertConnectorInstallation } from '../../../storage/sqlite/connector-repository.js';
import { SlackThreadSource } from '../slackThreadSource.js';

useTestDatabase();
describe('Slack scene connector boundary', () => {
  const principal = { ownerId: 'local-owner', workspaceId: 'test' };
  const executeWithPolicy = vi.fn();
  let source: SlackThreadSource;
  let accountId: string;
  const ts = '1234567890.123456';
  const response = (data: unknown) => ({ decision: 'allowed', result: { successful: true, data } });
  const thread = () => ({ accountId, teamId: 'T123', channelId: 'C123', threadTs: ts });

  beforeEach(() => {
    upsertConnectorInstallation({ id: 'installation', connectorId: 'composio-slack', principalId: principal.ownerId, enabled: true,
      allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null });
    accountId = upsertConnectorConnection({ id: 'connection', installationId: 'installation', connectorId: 'composio-slack', provider: 'composio',
      principalId: principal.ownerId, providerConnectionId: 'external', identity: {}, status: 'active', isDefault: true, metadata: {} }).accountId!;
    executeWithPolicy.mockReset().mockImplementation(async ({ action }) => action.actionId === 'SLACK_TEST_AUTH'
      ? response({ ok: true, team_id: 'T123' }) : response({ ok: true, messages: [{ ts, text: 'Please fix the bug', user: 'U1' }], has_more: false }));
    source = new SlackThreadSource(getSqliteDatabase(), { executeWithPolicy });
  });

  it('resolves links locally, verifies team identity, and reads only the selected thread', async () => {
    expect(await source.resolveLink(principal, accountId, `https://example.slack.com/archives/C123/p${ts.replace('.', '')}`, AbortSignal.timeout(1000))).toEqual(thread());
    const first = await source.read(principal, thread(), AbortSignal.timeout(1000));
    const second = await source.read(principal, thread(), AbortSignal.timeout(1000));
    expect(first.revision).toBe(second.revision);
    expect(executeWithPolicy.mock.calls.every(([call]) => call.action.scope === 'read')).toBe(true);
    expect(executeWithPolicy.mock.calls.at(-1)?.[0].args).toEqual({ channel: 'C123', ts, limit: 100 });
  });

  it('blocks wrong owners, withdrawn permission and workspace changes', async () => {
    expect(source.listAccounts({ ...principal, ownerId: 'other' })).toEqual([]);
    executeWithPolicy.mockResolvedValue(response({ team_id: 'T999' }));
    await expect(source.read(principal, thread(), AbortSignal.timeout(1000))).rejects.toThrow('workspace identity');
    getSqliteDatabase().prepare('UPDATE connector_accounts SET enabled = 0 WHERE id = ?').run(accountId);
    await expect(source.read(principal, thread(), AbortSignal.timeout(1000))).rejects.toThrow('permission');
  });

  it('accepts documented connector success envelopes without a successful flag and rejects explicit failure', async () => {
    executeWithPolicy.mockImplementation(async ({ action }) => ({ decision: 'allowed', result: { error: null, data: action.actionId === 'SLACK_TEST_AUTH'
      ? { ok: true, team_id: 'T123' } : { ok: true, messages: [{ ts, text: 'Root' }] } } }));
    expect((await source.read(principal, thread(), AbortSignal.timeout(1000))).text).toContain('Root');
    executeWithPolicy.mockResolvedValue({ decision: 'allowed', result: { successful: false, data: { team_id: 'T123' } } });
    await expect(source.read(principal, thread(), AbortSignal.timeout(1000))).rejects.toThrow('unavailable');
  });

  it('does not accept partial pages or messages from another thread', async () => {
    executeWithPolicy.mockImplementation(async ({ action }) => action.actionId === 'SLACK_TEST_AUTH' ? response({ team_id: 'T123' })
      : response({ messages: [{ ts, text: 'Root' }], has_more: true }));
    await expect(source.read(principal, thread(), AbortSignal.timeout(1000))).rejects.toThrow('incomplete');
    executeWithPolicy.mockImplementation(async ({ action }) => action.actionId === 'SLACK_TEST_AUTH' ? response({ team_id: 'T123' })
      : response({ messages: [{ ts: '1234567890.654321', text: 'Other', thread_ts: '1234567890.000000' }] }));
    await expect(source.read(principal, thread(), AbortSignal.timeout(1000))).rejects.toThrow('Unexpected');
  });

  it('detects edits and deletions while ignoring reaction-only metadata', async () => {
    let extra = true;
    let body = 'Root';
    executeWithPolicy.mockImplementation(async ({ action }) => action.actionId === 'SLACK_TEST_AUTH' ? response({ team_id: 'T123' })
      : response({ messages: [{ ts, text: body, reactions: [{ name: Math.random() }] }, ...(extra ? [{ ts: '1234567891.000000', thread_ts: ts, text: 'Reply' }] : [])] }));
    const read = () => source.read(principal, thread(), AbortSignal.timeout(1000));
    const original = await read(); expect((await read()).revision).toBe(original.revision);
    body = 'Edited'; const edited = await read(); expect(edited.revision).not.toBe(original.revision);
    extra = false; expect((await read()).revision).not.toBe(edited.revision);
  });

  it('marks attachment contents as unread instead of silently claiming complete evidence', async () => {
    executeWithPolicy.mockImplementation(async ({ action }) => action.actionId === 'SLACK_TEST_AUTH' ? response({ team_id: 'T123' })
      : response({ messages: [{ ts, text: 'See attached logs', files: [{ id: 'F1', name: 'log.txt', mimetype: 'text/plain', url_private: 'private-download' }] }] }));
    const result = await source.read(principal, thread(), AbortSignal.timeout(1000));
    expect(result.text).toContain('"contentFetched":false');
    expect(result.text).toContain('log.txt');
    expect(result.text).not.toContain('private-download');
  });

  it('rechecks permission after connector returns and enforces daily request budget', async () => {
    executeWithPolicy.mockImplementation(async () => {
      getSqliteDatabase().prepare('UPDATE connector_accounts SET enabled = 0 WHERE id = ?').run(accountId);
      return response({ team_id: 'T123' });
    });
    await expect(source.read(principal, thread(), AbortSignal.timeout(1000))).rejects.toThrow('permission');
    getSqliteDatabase().prepare('UPDATE connector_accounts SET enabled = 1 WHERE id = ?').run(accountId);
    getSqliteDatabase().prepare('UPDATE scene_connector_usage SET request_count = 3000').run();
    await expect(source.read(principal, thread(), AbortSignal.timeout(1000))).rejects.toThrow('budget');
  });
});
