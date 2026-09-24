import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureSchemaMetaTable, readSchemaVersion, setSchemaVersion } from '../schema-version.js';
import {
  applyPendingMigrations,
  XOPC_DB_BASELINE_SCHEMA_VERSION,
  XOPC_DB_SCHEMA_VERSION,
} from '../migrations/runner.js';
import { migrateConversationUuids } from '../migrations/conversation-uuid.js';
import { conversationRouteKey, resolveConversationRoute } from '../../../routing/conversation-route.js';

vi.mock('node:crypto', async (original) => {
  const crypto = await original<typeof import('node:crypto')>();
  return { ...crypto, randomUUID: vi.fn(crypto.randomUUID) };
});

const key = 'agent:coder:webchat:default:direct:chat_example';
const routing = { agentId: 'coder', source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'chat_example' };

let database: DatabaseSync;
function openXopcDatabase(_options: { path: string }): { db: DatabaseSync } { return { db: database }; }
function ensureSessionRecord(sessionKey: string, cwd: string, metadata: { routing: typeof routing }): { sessionId: string } {
  const sessionId = randomUUID();
  database.prepare(`INSERT INTO sessions(session_key,agent_id,session_id,created_at,updated_at,last_accessed_at,routing_json)
    VALUES (?,?,?,1,1,1,?)`).run(sessionKey, metadata.routing.agentId, sessionId, JSON.stringify(metadata.routing));
  database.prepare("INSERT INTO transcripts(session_id,session_key,status,created_at,cwd) VALUES (?,?,'active',1,?)").run(sessionId, sessionKey, cwd);
  return { sessionId };
}
function resetSessionRecord(sessionKey: string, cwd: string): { sessionId: string } {
  const sessionId = randomUUID();
  database.prepare("UPDATE transcripts SET status='archived' WHERE session_key=?").run(sessionKey);
  database.prepare("INSERT INTO transcripts(session_id,session_key,status,created_at,cwd) VALUES (?,?,'active',2,?)").run(sessionId, sessionKey, cwd);
  database.prepare('UPDATE sessions SET session_id=? WHERE session_key=?').run(sessionId, sessionKey);
  return { sessionId };
}

describe('one-time conversation UUID migration', () => {
  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys=ON');
    ensureSchemaMetaTable(database);
    database.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    setSchemaVersion(database, XOPC_DB_BASELINE_SCHEMA_VERSION);
    applyPendingMigrations(database, { targetVersion: 177 });
  });
  afterEach(() => database.close());

  it('preserves transcript generations, content and FTS while replacing every owner reference', () => {
    const { db } = openXopcDatabase({ path: ':memory:' });
    const first = ensureSessionRecord(key, '/workspace', { routing });
    const entryId = randomUUID();
    db.prepare(`INSERT INTO transcript_entries(entry_id,session_id,seq,entry_kind,role,payload_json,created_at)
      VALUES (?,?,1,'message','user',?,1)`).run(entryId, first.sessionId!, JSON.stringify({ role: 'user', content: key }));
    db.prepare('INSERT INTO transcript_fts(content,session_key,session_id,entry_id) VALUES (?,?,?,?)').run('hello', key, first.sessionId!, entryId);
    const second = resetSessionRecord(key, '/workspace')!;
    db.prepare('INSERT INTO session_config(session_key,updated_at) VALUES (?,1)').run(key);
    db.exec('BEGIN IMMEDIATE');
    const result = migrateConversationUuids(db);
    db.exec('COMMIT');
    const session = db.prepare('SELECT * FROM sessions').get()!;
    expect(session.conversation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.active_transcript_id).toBe(second.sessionId);
    expect(result).toEqual({ conversations: 1, historicalOwners: 0, routes: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM transcripts WHERE conversation_id=?').get(session.conversation_id)?.n).toBe(2);
    expect(db.prepare('SELECT conversation_id FROM session_config').get()?.conversation_id).toBe(session.conversation_id);
    expect(db.prepare('SELECT conversation_id FROM conversation_routes WHERE route_key=?').get(conversationRouteKey(resolveConversationRoute(routing)))?.conversation_id).toBe(session.conversation_id);
    expect(db.prepare('SELECT payload_json FROM transcript_entries WHERE entry_id=?').get(entryId)?.payload_json).toBe(JSON.stringify({ role: 'user', content: key }));
    expect(db.prepare("SELECT transcript_id FROM transcript_fts WHERE transcript_fts MATCH 'hello'").get()?.transcript_id).toBe(first.sessionId);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('retains deleted historical owners without recreating a visible session', () => {
    const { db } = openXopcDatabase({ path: ':memory:' });
    const transcriptId = randomUUID();
    db.prepare("INSERT INTO transcripts(session_id,session_key,status,created_at,cwd) VALUES (?,?,'archived',1,'/workspace')").run(transcriptId, key);
    db.exec('BEGIN IMMEDIATE');
    expect(migrateConversationUuids(db).historicalOwners).toBe(1);
    db.exec('COMMIT');
    expect(db.prepare('SELECT count(*) AS n FROM sessions').get()?.n).toBe(0);
    expect(db.prepare('SELECT transcript_id FROM transcripts').get()?.transcript_id).toBe(transcriptId);
  });

  it('runs exactly once through the upgrade runner and supplies missing routing metadata', () => {
    const original = ensureSessionRecord(key, '/workspace', { routing });
    database.prepare('UPDATE sessions SET routing_json=NULL').run();
    expect(applyPendingMigrations(database)).toBe(XOPC_DB_SCHEMA_VERSION);
    const migrated = database.prepare('SELECT * FROM sessions').get()!;
    expect(migrated.active_transcript_id).toBe(original.sessionId);
    expect(JSON.parse(String(migrated.routing_json))).toMatchObject(routing);
    expect(applyPendingMigrations(database)).toBe(XOPC_DB_SCHEMA_VERSION);
    expect(database.prepare('SELECT * FROM sessions').get()).toEqual(migrated);
  });

  it('keeps the schema version and original data when the runner rejects an unresolved reference', () => {
    ensureSessionRecord(key, '/workspace', { routing });
    database.exec('CREATE TABLE unsupported_feature(session_key TEXT)');
    expect(() => applyPendingMigrations(database)).toThrow('Unregistered conversation reference');
    expect(readSchemaVersion(database)).toBe(177);
    expect(database.prepare('SELECT session_key FROM sessions').get()?.session_key).toBe(key);
  });

  it('updates share and receipt control records but preserves immutable share content', () => {
    const original = ensureSessionRecord(key, '/workspace', { routing });
    const insert = database.prepare('INSERT INTO durable_state(namespace,scope,key,payload) VALUES (?,?,?,?)');
    insert.run('shares', 'default', 'share-1', JSON.stringify({ kind: 'session', sourceSessionKey: key, sourceSessionId: original.sessionId, content: { sessionKey: key } }));
    insert.run('command-receipts', key, 'receipt-1', JSON.stringify({ sessionKey: key, logPath: '/old-hash/output.log' }));
    applyPendingMigrations(database);
    const id = database.prepare('SELECT conversation_id FROM sessions').get()!.conversation_id;
    const share = database.prepare("SELECT payload FROM durable_state WHERE key='share-1'").get()!;
    expect(JSON.parse(String(share.payload))).toEqual({ kind: 'session', sourceConversationId: id, sourceTranscriptId: original.sessionId, content: { sessionKey: key } });
    const receipt = database.prepare("SELECT scope,payload FROM durable_state WHERE key='receipt-1'").get()!;
    expect(receipt.scope).toBe(id);
    expect(JSON.parse(String(receipt.payload))).toEqual({ conversationId: id, logPath: '/old-hash/output.log' });
  });

  it('rolls back schema, IDs and FTS on failure before commit', () => {
    const { db } = openXopcDatabase({ path: ':memory:' });
    const original = ensureSessionRecord(key, '/workspace', { routing });
    db.exec('BEGIN IMMEDIATE');
    migrateConversationUuids(db);
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT session_key,session_id FROM sessions').get()).toMatchObject({ session_key: key, session_id: original.sessionId });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='conversation_routes'").get()).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS n FROM transcript_fts').get()?.n).toBe(0);
  });

  it('fails closed for unregistered references and missing active owners', () => {
    const { db } = openXopcDatabase({ path: ':memory:' });
    db.exec('CREATE TABLE future_feature(session_key TEXT)');
    db.exec('BEGIN IMMEDIATE');
    expect(() => migrateConversationUuids(db)).toThrow('Unregistered conversation reference');
    db.exec('ROLLBACK');
  });

  it('updates recovery JSON and pending deliveries without changing transcript or message identity', () => {
    const { db } = openXopcDatabase({ path: ':memory:' });
    const original = ensureSessionRecord(key, '/workspace', { routing });
    const data = { sessionKey: key, sessionId: original.sessionId, content: { sessionKey: key }, version: 8 };
    db.prepare(`INSERT INTO session_connection_waits(id,principal_id,session_key,session_id,status,version,data_json)
      VALUES ('wait','owner',?,?,'open',8,?)`).run(key, original.sessionId!, JSON.stringify(data));
    db.prepare("INSERT INTO durable_messages(queue,scope,id,payload,enqueued_at) VALUES ('outbound','telegram','message',?,1)")
      .run(JSON.stringify({ message: { sessionKey: key, content: key, chatId: key, target: { kind: 'session', id: key } } }));
    db.exec('BEGIN IMMEDIATE');
    migrateConversationUuids(db);
    db.exec('COMMIT');
    const id = db.prepare('SELECT conversation_id FROM sessions').get()!.conversation_id;
    const wait = db.prepare('SELECT * FROM session_connection_waits').get()!;
    expect(wait.conversation_id).toBe(id);
    expect(wait.transcript_id).toBe(original.sessionId);
    expect(JSON.parse(String(wait.data_json))).toEqual({ conversationId: id, transcriptId: original.sessionId, content: { sessionKey: key }, version: 8 });
    const message = db.prepare('SELECT id,payload FROM durable_messages').get()!;
    expect(message.id).toBe('message');
    expect(JSON.parse(String(message.payload))).toEqual({ message: { conversationId: id, content: key, chatId: id, target: { kind: 'session', id } } });
  });

  it('preserves project summary content and transcript provenance while updating its lookup identity', () => {
    ensureSessionRecord(key, '/workspace', { routing });
    database.prepare(`INSERT INTO knowledge_items(knowledge_id,principal_id,kind,scope_type,scope_id,
      content,canonical_key,status,confidence,importance,origin_class,source_session_id,created_at,updated_at)
      VALUES ('summary','owner','project_fact','project','project-1',?,?,'active',1,1,'agent',?,1,1)`)
      .run(key, `project-session-summary:project-1:${key}`, key);
    applyPendingMigrations(database);
    const id = database.prepare('SELECT conversation_id FROM sessions').get()!.conversation_id;
    expect(database.prepare('SELECT content,canonical_key,source_conversation_id FROM knowledge_items').get())
      .toEqual({ content: key, canonical_key: `project-session-summary:project-1:${id}`, source_conversation_id: id });
  });

  it('recovers the profile owner of historical workflow actors without changing their messages', () => {
    const oldKey = 'agent:main:workflow:run-1:subagent:agent-1';
    const original = ensureSessionRecord(oldKey, '/workspace', { routing: { ...routing, agentId: 'agent-1', source: 'workflow' } });
    database.prepare("UPDATE sessions SET session_type='workflow-subagent', workflow_agent_id='agent-1', workflow_run_id='run-1'").run();
    database.prepare("INSERT INTO transcript_entries(entry_id,session_id,seq,entry_kind,role,payload_json,created_at) VALUES ('entry',?,1,'message','assistant',?,1)")
      .run(original.sessionId, '{"content":"workflow result"}');
    applyPendingMigrations(database);
    const migrated = database.prepare('SELECT * FROM sessions').get()!;
    expect(migrated.agent_id).toBe('main');
    expect(migrated.workflow_agent_id).toBe('agent-1');
    expect(JSON.parse(String(migrated.routing_json)).agentId).toBe('main');
    expect(migrated.active_transcript_id).toBe(original.sessionId);
    expect(database.prepare('SELECT payload_json FROM transcript_entries').get()?.payload_json).toBe('{"content":"workflow result"}');
    expect(database.prepare('SELECT conversation_id FROM conversation_routes WHERE route_key=?')
      .get(conversationRouteKey(resolveConversationRoute({ agentId: 'main', source: 'workflow', peerKind: 'direct', peerId: 'run-1/agent-1' })))?.conversation_id).toBe(migrated.conversation_id);
  });

  it('rewrites every indexed source reference exactly once', () => {
    ensureSessionRecord(key, '/workspace', { routing });
    const insert = database.prepare("INSERT INTO context_extraction_runs(extraction_run_id,principal_id,source_ref,extractor_id,extractor_version,processing_policy,destination,input_hash,status,started_at) VALUES (?,'owner',?,'test','1','local_only','deterministic','hash','completed',1)");
    for (const turn of ['one', 'two']) insert.run(turn, `session:${key}:turn:${turn}`);
    applyPendingMigrations(database);
    const id = String(database.prepare('SELECT conversation_id FROM sessions').get()?.conversation_id);
    expect(database.prepare('SELECT source_ref FROM context_extraction_runs ORDER BY extraction_run_id').all())
      .toEqual([{ source_ref: `session:${id}:turn:one` }, { source_ref: `session:${id}:turn:two` }]);
  });

  it('still rejects an unrelated profile mismatch and keeps the old database intact', () => {
    ensureSessionRecord('agent:main:workflow:run-1:subagent:agent-1', '/workspace', { routing: { ...routing, agentId: 'unrelated' } });
    expect(() => applyPendingMigrations(database)).toThrow('Unresolvable conversation owner');
    expect(readSchemaVersion(database)).toBe(177);
    expect(database.prepare('SELECT count(*) AS n FROM transcripts').get()?.n).toBe(1);
  });

  it('preserves external import and fork provenance without requiring a local owner', () => {
    const original = ensureSessionRecord(key, '/workspace', { routing });
    const provenance = {
      importedFromSessionKey: 'agent:foreign:webchat:default:direct:exported',
      forkedFromSessionKey: 'agent:foreign:webchat:default:direct:ancestor',
      forkedFromSessionId: 'external-transcript',
      importedAt: '2026-09-01T00:00:00.000Z',
    };
    database.prepare('UPDATE sessions SET custom_data_json=?').run(JSON.stringify(provenance));
    const payload = JSON.stringify({ role: 'user', content: provenance.importedFromSessionKey });
    database.prepare("INSERT INTO transcript_entries(entry_id,session_id,seq,entry_kind,role,payload_json,created_at) VALUES ('imported-entry',?,1,'message','user',?,1)")
      .run(original.sessionId, payload);

    expect(applyPendingMigrations(database)).toBe(XOPC_DB_SCHEMA_VERSION);
    const migrated = database.prepare('SELECT * FROM sessions').get()!;
    const customData = JSON.parse(String(migrated.custom_data_json));
    expect(customData).toMatchObject({
      importedFromExternalConversationRef: provenance.importedFromSessionKey,
      forkedFromExternalConversationRef: provenance.forkedFromSessionKey,
      forkedFromTranscriptId: provenance.forkedFromSessionId,
      importedAt: provenance.importedAt,
    });
    expect(customData).not.toHaveProperty('importedFromSessionKey');
    expect(customData).not.toHaveProperty('forkedFromSessionKey');
    expect(customData).not.toHaveProperty('importedFromConversationId');
    expect(customData).not.toHaveProperty('forkedFromConversationId');
    expect(migrated.active_transcript_id).toBe(original.sessionId);
    expect(database.prepare('SELECT payload_json FROM transcript_entries').get()?.payload_json).toBe(payload);
    expect(database.prepare('SELECT count(*) AS n FROM sessions').get()?.n).toBe(1);
    expect(applyPendingMigrations(database)).toBe(XOPC_DB_SCHEMA_VERSION);
    expect(database.prepare('SELECT * FROM sessions').get()).toEqual(migrated);
  });

  it('maps locally resolvable import and fork provenance to conversation UUIDs', () => {
    const source = ensureSessionRecord(key, '/workspace', { routing });
    const targetKey = 'agent:coder:webchat:default:direct:imported-copy';
    const target = ensureSessionRecord(targetKey, '/workspace', { routing });
    database.prepare('UPDATE sessions SET custom_data_json=? WHERE session_key=?').run(JSON.stringify({
      importedFromSessionKey: key, forkedFromSessionKey: key,
    }), targetKey);
    applyPendingMigrations(database);
    const sourceId = database.prepare('SELECT conversation_id FROM sessions WHERE active_transcript_id=?').get(source.sessionId)!.conversation_id;
    const migrated = database.prepare('SELECT * FROM sessions WHERE active_transcript_id=?').get(target.sessionId)!;
    expect(JSON.parse(String(migrated.custom_data_json))).toMatchObject({
      importedFromConversationId: sourceId,
      forkedFromConversationId: sourceId,
    });
    expect(sourceId).not.toBe(migrated.conversation_id);
  });

  it('still rolls back unresolved strong JSON references', () => {
    ensureSessionRecord(key, '/workspace', { routing });
    const json = JSON.stringify({ parentSessionKey: 'agent:missing:main' });
    database.prepare('UPDATE sessions SET custom_data_json=?').run(json);
    expect(() => applyPendingMigrations(database)).toThrow('Missing conversation referenced by persisted state');
    expect(readSchemaVersion(database)).toBe(177);
    expect(database.prepare('SELECT custom_data_json FROM sessions').get()?.custom_data_json).toBe(json);
  });

  it('rejects missing references without dropping the pending input', () => {
    const { db } = openXopcDatabase({ path: ':memory:' });
    ensureSessionRecord(key, '/workspace', { routing });
    db.prepare(`INSERT INTO session_connection_waits(id,principal_id,session_key,session_id,status,version,data_json)
      VALUES ('wait','owner',?,?,'open',1,'{}')`).run('agent:missing:main', randomUUID());
    db.exec('BEGIN IMMEDIATE');
    expect(() => migrateConversationUuids(db)).toThrow('Unresolved session_connection_waits.session_key');
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT session_key FROM session_connection_waits').get()?.session_key).toBe('agent:missing:main');
    expect(db.prepare('SELECT session_key FROM sessions').get()?.session_key).toBe(key);
  });
});
