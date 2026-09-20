import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SceneActivation } from '../contracts.js';
import { SceneMailContextProvider } from '../mailContext.js';

describe('scene mail context', () => {
  let db: DatabaseSync;
  const activation: SceneActivation = {
    id: 'activation', ownerId: 'local-owner', workspaceId: 'workspace', templateKey: 'mail-follow-up', templateVersion: '1.0.0',
    goal: 'Get a reply', scope: { kind: 'objects', ids: ['origin'] }, status: 'active', revision: 1,
    permissions: { contextProviders: ['mail'], accountIds: ['personal'], effectHandlers: [] },
  };
  const read = (overrides: Partial<Parameters<SceneMailContextProvider['read']>[0]> = {}) => new SceneMailContextProvider(db, () => 2000).read({
    activation, subjectId: 'origin', permissions: activation.permissions, signal: new AbortController().signal, ...overrides,
  });

  const insert = (id: string, connectionId = 'connection', source = 'source', workspaceId = 'workspace', sensitivity = 'normal') => {
    db.prepare('INSERT INTO knowledge_source_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .run(id, source, 'mail', 'email', 'revision-1', JSON.stringify({ threadId: 'same-thread-id', body: id, labels: [] }), sensitivity,
        JSON.stringify({ connectionId, workspaceId }), 1000);
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE connector_accounts(id TEXT, principal_id TEXT, current_connection_id TEXT, enabled INTEGER, connector_id TEXT, allowed_agent_ids_json TEXT);
      CREATE TABLE connector_connections(id TEXT, account_id TEXT, status TEXT, expires_at TEXT, principal_id TEXT, connector_id TEXT, installation_id TEXT);
      CREATE TABLE connector_installations(id TEXT, principal_id TEXT, connector_id TEXT, enabled INTEGER, allowed_agent_ids_json TEXT, selected_account_ids_json TEXT);
      CREATE TABLE knowledge_source_items(item_id TEXT, source_instance_id TEXT, collection_scope TEXT, item_type TEXT, content_hash TEXT,
        normalized_text TEXT, sensitivity TEXT, metadata_json TEXT, occurred_at INTEGER, deleted_at INTEGER);
      CREATE TABLE knowledge_sync_runs(source_instance_id TEXT, collection_scope TEXT, status TEXT, started_at INTEGER, finished_at INTEGER);
      INSERT INTO connector_installations VALUES ('installation', 'local-owner', 'gmail', 1, '[]', 'null');
      INSERT INTO connector_accounts VALUES ('personal', 'local-owner', 'connection', 1, 'gmail', NULL), ('work', 'local-owner', 'work-connection', 1, 'gmail', NULL);
      INSERT INTO connector_connections VALUES ('connection', 'personal', 'active', NULL, 'local-owner', 'gmail', 'installation'), ('work-connection', 'work', 'active', NULL, 'local-owner', 'gmail', 'installation');
      INSERT INTO knowledge_sync_runs VALUES ('source', 'mail', 'succeeded', 1500, 1600);`);
    insert('origin');
  });
  afterEach(() => db.close());

  it('lists only owned active mail metadata, with bounded paging and no message bodies', () => {
    insert('reply'); insert('foreign-workspace', 'connection', 'source', 'other'); insert('secret', 'connection', 'source', 'workspace', 'secret');
    insert('malformed');
    db.prepare('UPDATE knowledge_source_items SET normalized_text = ? WHERE item_id = ?').run('invalid json', 'malformed');
    const provider = new SceneMailContextProvider(db, () => 2000);
    const principal = { ownerId: activation.ownerId, workspaceId: activation.workspaceId };
    expect(provider.listSources(principal, 1)).toEqual([{ id: 'origin', accountId: 'personal', subject: '', sender: '' }]);
    expect(provider.listSources(principal, 1, 'origin').map((item) => item.id)).toEqual(['reply']);
    expect(provider.listSources({ ...principal, ownerId: 'other' })).toEqual([]);
    db.exec("UPDATE connector_connections SET expires_at = 'invalid'");
    expect(provider.listSources(principal)).toEqual([]);
  });

  it('reads only the matching source, collection, workspace and connection', async () => {
    insert('reply'); insert('other-account', 'work-connection'); insert('other-source', 'connection', 'another');
    insert('other-workspace', 'connection', 'source', 'another');
    const evidence = await read();
    expect(evidence.map((item) => item.id)).toEqual(['origin', 'reply']);
    expect(evidence.every((item) => item.accountId === 'personal' && item.subjectId === 'origin')).toBe(true);
  });

  it('rejects revoked account permissions and principals', async () => {
    await expect(read({ permissions: { ...activation.permissions, accountIds: ['work'] } })).rejects.toThrow('permission');
    await expect(read({ activation: { ...activation, ownerId: 'someone-else' } })).rejects.toThrow('permission');
    db.exec("UPDATE connector_connections SET status = 'revoked'");
    await expect(read()).rejects.toThrow('permission');
  });

  it.each([
    "UPDATE connector_accounts SET enabled = 0",
    "UPDATE connector_accounts SET current_connection_id = 'replacement'",
    "UPDATE connector_installations SET enabled = 0",
    "UPDATE connector_installations SET principal_id = 'someone-else'",
    "UPDATE connector_accounts SET principal_id = 'someone-else'",
    "UPDATE connector_installations SET selected_account_ids_json = '[]'",
    "UPDATE connector_installations SET allowed_agent_ids_json = '[\"restricted-agent\"]'",
    "UPDATE connector_accounts SET allowed_agent_ids_json = '[\"restricted-agent\"]'",
  ])('rejects unavailable connector ownership or policy: %s', async (sql) => {
    db.exec(sql);
    await expect(read()).rejects.toThrow('permission');
    expect(new SceneMailContextProvider(db, () => 2000).listSources(activation)).toEqual([]);
  });

  it.each(['1970-01-01T00:00:02.000Z', 'invalid'])('rejects expired or malformed connection expiry: %s', async (expiresAt) => {
    db.prepare('UPDATE connector_connections SET expires_at = ?').run(expiresAt);
    await expect(read()).rejects.toThrow('expired');
  });

  it('requires a successful pull after the deadline, not merely recently cached content', async () => {
    await expect(read({ notBefore: 1600 })).rejects.toThrow('stale');
    await expect(read({ notBefore: 1400 })).resolves.toHaveLength(1);
    db.exec("INSERT INTO knowledge_sync_runs VALUES ('source', 'mail', 'failed', 1700, 1800)");
    await expect(read()).rejects.toThrow('stale');
  });

  it('rejects a restricted thread rather than silently hiding an important reply', async () => {
    insert('restricted-reply', 'connection', 'source', 'workspace', 'secret');
    await expect(read()).rejects.toThrow('restricted');
  });

  it('does not silently truncate large threads', async () => {
    for (let index = 0; index < 30; index += 1) insert(`message-${index}`);
    await expect(read()).rejects.toThrow('budget');
  });

  it('excludes drafts and refuses a draft as its origin', async () => {
    insert('draft');
    db.prepare('UPDATE knowledge_source_items SET normalized_text = ? WHERE item_id = ?')
      .run(JSON.stringify({ threadId: 'same-thread-id', labels: ['DRAFT'] }), 'draft');
    expect((await read()).map((item) => item.id)).toEqual(['origin']);
    await expect(read({ subjectId: 'draft' })).rejects.toThrow('active message');
  });
});
