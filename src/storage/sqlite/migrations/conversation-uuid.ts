import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { conversationRouteKey } from '../../../routing/conversation-route.js';
import { decodeStoredConversationKey, decodeStoredWorkflowSubagent } from './conversation-key-decoder.js';

const KEY_COLUMNS: Record<string, readonly string[]> = {
  sessions: ['session_key', 'parent_session_key'],
  transcripts: ['session_key'],
  session_config: ['session_key'],
  session_inputs: ['session_key'],
  session_input_runtime: ['session_key'],
  session_connection_waits: ['session_key'],
  session_clarification_waits: ['session_key'],
  task_sessions: ['session_key'],
  task_runs: ['session_key'],
  task_conversation_state: ['active_session_key'],
  task_handoff_snapshots: ['from_session_key', 'to_session_key'],
  workflow_runs: ['session_key', 'parent_session_key'],
  automation_runs: ['session_key'],
  work_discovery_runs: ['session_key'],
  endpoint_session_bindings: ['session_key'],
  browser_tab_bindings: ['session_key'],
  execution_environment_bindings: ['session_key'],
  interaction_states: ['session_key'],
  proactive_follow_ups: ['session_key'],
  context_snapshots: ['session_key'],
  connector_approvals: ['session_key'],
  connector_execution_audit: ['session_key'],
};

const TRANSCRIPT_COLUMNS: Record<string, Record<string, string>> = {
  sessions: { session_id: 'active_transcript_id' },
  transcripts: { session_id: 'transcript_id' },
  transcript_entries: { session_id: 'transcript_id' },
  compaction_checkpoints: { session_id: 'transcript_id' },
  session_task_plans: { session_id: 'transcript_id' },
  session_connection_waits: { session_id: 'transcript_id' },
  session_clarification_waits: { session_id: 'transcript_id' },
  session_inputs: { expected_session_id: 'expected_transcript_id' },
};

const CONTROL_JSON_COLUMNS: Record<string, readonly string[]> = {
  sessions: ['routing_json', 'custom_data_json'],
  session_inputs: ['origin_json', 'context_refs_json', 'payload_json'],
  session_connection_waits: ['data_json'],
  session_clarification_waits: ['data_json'],
  task_handoff_snapshots: ['payload_json'],
  task_runs: ['executor_ref_json', 'trigger_json'],
  task_waits: ['condition_json', 'resolution_json'],
  automations: ['action_json', 'state_json'],
  automation_runs: ['action_snapshot_json', 'termination_json'],
  workflow_runs: ['source_json', 'metadata_json'],
  notification_events: ['target_json', 'payload_json'],
  proactive_channel_deliveries: ['target_json'],
  domain_outbox: ['payload_json'],
  command_deduplication: ['result_json'],
  activity_events: ['source_json', 'payload_json'],
  task_run_events: ['payload_json'],
  workflow_events: ['payload'],
  knowledge_items: ['source_json'],
};

const DURABLE_NAMESPACES = new Set([
  'shares', 'site-shares', 'hosted-share-bindings', 'command-receipts',
  'workflow-drafts', 'workflow-definitions', 'workflow-revisions',
]);

const OBJECT_REFERENCES: ReadonlyArray<readonly [string, string, string]> = [
  ['object_links', 'from_kind', 'from_id'], ['object_links', 'to_kind', 'to_id'],
  ['activity_events', 'primary_object_kind', 'primary_object_id'],
  ['activity_scopes', 'scope_kind', 'scope_id'],
  ['context_edges', 'owner_kind', 'owner_id'], ['context_edges', 'target_kind', 'target_id'],
  ['context_snapshots', 'owner_kind', 'owner_id'],
  ['knowledge_items', 'scope_type', 'scope_id'],
  ['command_deduplication', 'subject_kind', 'subject_id'],
  ['domain_outbox', 'subject_kind', 'subject_id'],
  ['proactive_events', 'subject_kind', 'subject_id'],
];

const REFERENCE_NAMES: Record<string, string> = {
  sessionKey: 'conversationId',
  parentSessionKey: 'parentConversationId', fromSessionKey: 'fromConversationId',
  toSessionKey: 'toConversationId', activeSessionKey: 'activeConversationId',
};

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map(row => row.name));
}

function assertForeignKeys(db: DatabaseSync): void {
  const errors = db.prepare('PRAGMA foreign_key_check').all();
  if (errors.length) throw new Error(`Conversation migration has ${errors.length} invalid foreign keys`);
}

export interface ConversationMigrationSummary {
  conversations: number;
  historicalOwners: number;
  routes: number;
}

/** Runs inside the migration runner's single transaction. */
export function migrateConversationUuids(db: DatabaseSync): ConversationMigrationSummary {
  db.exec('PRAGMA defer_foreign_keys = ON');
  assertForeignKeys(db);
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name);
  for (const table of tables) {
    if (table === 'transcript_fts' || table.startsWith('transcript_fts_')) continue;
    for (const column of columns(db, table)) {
      if (column.endsWith('session_key') && !KEY_COLUMNS[table]?.includes(column)) {
        throw new Error(`Unregistered conversation reference: ${table}.${column}`);
      }
    }
  }
  db.exec(`CREATE TEMP TABLE conversation_id_map (
    old_key TEXT PRIMARY KEY, conversation_id TEXT NOT NULL UNIQUE
  );
  CREATE TABLE conversation_routes (
    route_key TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE
  );`);

  const owners = db.prepare(`SELECT session_key FROM sessions UNION SELECT session_key FROM transcripts`).all() as { session_key: string }[];
  const mapping = new Map<string, string>();
  const insert = db.prepare('INSERT INTO conversation_id_map VALUES (?, ?)');
  for (const owner of owners) {
    const id = randomUUID();
    mapping.set(owner.session_key, id);
    insert.run(owner.session_key, id);
  }
  const resolve = (key: string): string => {
    const id = mapping.get(key);
    if (!id) throw new Error(`Missing conversation referenced by persisted state: ${key}`);
    return id;
  };

  const sessions = db.prepare('SELECT session_key, agent_id, routing_json, source_channel, source_chat_id, session_type, custom_data_json FROM sessions').all() as {
    session_key: string; agent_id: string; routing_json: string | null;
    source_channel: string; source_chat_id: string; session_type: string | null; custom_data_json: string | null;
  }[];
  const bind = db.prepare('INSERT INTO conversation_routes(route_key, conversation_id) VALUES (?, ?)');
  const updateRouting = db.prepare('UPDATE sessions SET agent_id=?, routing_json=?, source_channel=?, source_chat_id=?, session_type=?, custom_data_json=? WHERE session_key=?');
  for (const session of sessions) {
    const route = decodeStoredConversationKey(session.session_key, session.agent_id);
    bind.run(conversationRouteKey(route), resolve(session.session_key));
    const workflow = decodeStoredWorkflowSubagent(session.session_key);
    const stored = session.routing_json ? JSON.parse(session.routing_json) : {};
    if (stored.agentId && ![route.agentId, workflow?.actorId].includes(stored.agentId.toLowerCase())) throw new Error(`Conflicting conversation agent: ${session.session_key}`);
    const source = stored.source || session.source_channel || route.channel || 'cli';
    const peerId = stored.peerId || session.source_chat_id || route.peerId;
    const routing = {
      source, accountId: route.accountId || 'default', peerKind: route.peerKind, peerId,
      ...(route.threadId ? { threadId: route.threadId } : {}),
      ...(route.scopeId ? { scopeId: route.scopeId } : {}),
      ...stored, agentId: route.agentId,
    };
    const sessionType = session.session_key.startsWith('heartbeat:') ? 'heartbeat'
      : session.session_key.includes(':subagent:') ? 'workflow-subagent'
      : session.session_key.includes(':cron:') ? 'cron' : session.session_type ?? 'chat';
    const customData = session.custom_data_json ? JSON.parse(session.custom_data_json) : {};
    if (customData.genericNewChatShell === undefined && source === 'webchat' && peerId.startsWith('chat_') && !customData.sourceBinding) {
      customData.genericNewChatShell = true;
    }
    updateRouting.run(route.agentId, JSON.stringify(routing), source, peerId, sessionType, JSON.stringify(customData), session.session_key);
  }

  for (const [table, references] of Object.entries(KEY_COLUMNS)) {
    const present = columns(db, table);
    for (const column of references) {
      if (!present.has(column)) continue;
      const missing = db.prepare(`SELECT ${quote(column)} AS value FROM ${quote(table)}
        WHERE ${quote(column)} IS NOT NULL AND ${quote(column)} NOT IN (SELECT old_key FROM conversation_id_map) LIMIT 1`).get() as { value: string } | undefined;
      if (missing) throw new Error(`Unresolved ${table}.${column}: ${missing.value}`);
      db.exec(`UPDATE ${quote(table)} SET ${quote(column)} =
        (SELECT conversation_id FROM conversation_id_map WHERE old_key = ${quote(table)}.${quote(column)})
        WHERE ${quote(column)} IS NOT NULL`);
    }
  }

  const rewrite = (value: unknown, transcriptFields = false): unknown => {
    if (Array.isArray(value)) return value.map(item => rewrite(item, transcriptFields));
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    const conversationReference = ['session', 'conversation', 'chat'].includes(String(record.kind ?? record.type));
    return Object.fromEntries(Object.entries(record).filter(([name]) => name !== 'mainSessionKey').map(([name, child]) => {
      if ((name === 'id' && conversationReference || ['chatId', 'chat_id', 'to', 'targetChatId'].includes(name)) && typeof child === 'string' && mapping.has(child)) return [name, resolve(child)];
      if (name === 'key' && typeof child === 'string' && mapping.has(child)) return [name, resolve(child)];
      // Import/export copies provenance from other databases; it is not a local foreign key.
      if ((name === 'importedFromSessionKey' || name === 'forkedFromSessionKey') && typeof child === 'string') {
        return mapping.has(child)
          ? [name.replace('SessionKey', 'ConversationId'), resolve(child)]
          : [name.replace('SessionKey', 'ExternalConversationRef'), child];
      }
      if (REFERENCE_NAMES[name] && typeof child === 'string') return [REFERENCE_NAMES[name], resolve(child)];
      if (name.endsWith('SessionKey') && typeof child === 'string') return [name.replace(/SessionKey$/, 'ConversationId'), resolve(child)];
      if ((name === 'sessionKeys' || name.endsWith('SessionKeys')) && Array.isArray(child)) return [name.replace('sessionKeys', 'conversationIds').replace(/SessionKeys$/, 'ConversationIds'), child.map(key => resolve(String(key)))];
      if (name === 'expectedSessionId' || name === 'forkedFromSessionId') return [name.replace('SessionId', 'TranscriptId'), child];
      if ((name === 'sessionId' || name === 'sourceSessionId') && typeof child === 'string' && mapping.has(child)) {
        return [name === 'sessionId' ? 'conversationId' : 'sourceConversationId', resolve(child)];
      }
      if (transcriptFields && (name === 'sessionId' || name === 'expectedSessionId')) {
        return [name === 'sessionId' ? 'transcriptId' : 'expectedTranscriptId', child];
      }
      if (['content', 'text', 'arguments', 'prompt', 'messages', 'transcriptRows'].includes(name)) return [name, child];
      return [name, rewrite(child, transcriptFields)];
    }));
  };
  for (const [table, fields] of Object.entries(CONTROL_JSON_COLUMNS)) {
    const present = columns(db, table);
    for (const field of fields) {
      if (!present.has(field)) continue;
      const update = db.prepare(`UPDATE ${quote(table)} SET ${quote(field)} = ? WHERE rowid = ?`);
      const rows = db.prepare(`SELECT rowid AS row_id, ${quote(field)} AS value FROM ${quote(table)} WHERE ${quote(field)} IS NOT NULL`);
      for (const row of rows.all() as Iterable<{ row_id: number; value: string }>) {
        const next = JSON.stringify(rewrite(JSON.parse(row.value), table === 'session_connection_waits' || table === 'session_clarification_waits'));
        if (next !== row.value) update.run(next, row.row_id);
      }
    }
  }

  // Materialize rows before updating indexed fields; a live cursor can revisit moved rows.
  for (const table of ['context_evidence', 'context_extraction_runs']) {
    const rows = db.prepare(`SELECT rowid AS row_id, source_ref FROM ${table} WHERE source_ref LIKE 'session:%'`);
    const update = db.prepare(`UPDATE ${table} SET source_ref=? WHERE rowid=?`);
    const orderedKeys = [...mapping.keys()].sort((a, b) => b.length - a.length);
    for (const row of rows.all() as Iterable<{ row_id: number; source_ref: string }>) {
      const oldKey = orderedKeys.find(key => row.source_ref === `session:${key}` || row.source_ref.startsWith(`session:${key}:`));
      if (!oldKey) throw new Error(`Unresolved ${table}.source_ref`);
      update.run(`session:${resolve(oldKey)}${row.source_ref.slice(8 + oldKey.length)}`, row.row_id);
    }
  }

  // These are generated lookup keys, rather than user-authored knowledge content.
  const summaries = db.prepare("SELECT rowid AS row_id, canonical_key FROM knowledge_items WHERE canonical_key LIKE 'project-session-summary:%'");
  const updateSummary = db.prepare('UPDATE knowledge_items SET canonical_key=? WHERE rowid=?');
  for (const row of summaries.all() as Iterable<{ row_id: number; canonical_key: string }>) {
    const oldKey = [...mapping.keys()].find(key => row.canonical_key.endsWith(`:${key}`));
    if (!oldKey) throw new Error('Unresolved project session summary reference');
    updateSummary.run(row.canonical_key.slice(0, -oldKey.length) + resolve(oldKey), row.row_id);
  }

  for (const table of ['durable_state', 'durable_messages']) {
    const discriminator = table === 'durable_state' ? 'namespace' : 'queue';
    const rows = db.prepare(`SELECT rowid AS row_id, ${discriminator} AS kind, scope, payload FROM ${table}`);
    const update = db.prepare(`UPDATE ${table} SET payload=?, scope=? WHERE rowid=?`);
    for (const row of rows.all() as Iterable<{ row_id: number; kind: string; scope: string; payload: string }>) {
      const supported = table === 'durable_state' ? DURABLE_NAMESPACES.has(row.kind) : row.kind === 'outbound' || row.kind === 'agent-ipc';
      if (!supported) {
        if (/"(?:sessionKey|parentSessionKey)"\s*:/.test(row.payload)) {
          throw new Error(`Conversation migration requires a decoder for ${table}:${row.kind}`);
        }
        continue;
      }
      const payload = rewrite(JSON.parse(row.payload)) as Record<string, unknown>;
      if (row.kind === 'shares' && payload.kind === 'session' && typeof payload.sourceSessionId === 'string') {
        payload.sourceTranscriptId = payload.sourceSessionId;
        delete payload.sourceSessionId;
      }
      if (row.kind === 'hosted-share-bindings' && typeof payload.sessionId === 'string') {
        payload.transcriptId = payload.sessionId;
        delete payload.sessionId;
      }
      update.run(JSON.stringify(payload), mapping.get(row.scope) ?? row.scope, row.row_id);
    }
  }

  for (const [table, kind, id] of OBJECT_REFERENCES) {
    const present = columns(db, table);
    if (!present.has(kind) || !present.has(id)) continue;
    const rows = db.prepare(`SELECT rowid AS row_id, ${quote(id)} AS value FROM ${quote(table)} WHERE ${quote(kind)} IN ('session','conversation','chat') AND ${quote(id)} IS NOT NULL`);
    const update = db.prepare(`UPDATE ${quote(table)} SET ${quote(id)}=? WHERE rowid=?`);
    for (const row of rows.all() as Iterable<{ row_id: number; value: string }>) update.run(resolve(row.value), row.row_id);
  }

  for (const [table, from, to] of [
    ['execution_context_runs', 'session_id', 'conversation_id'],
    ['context_evidence', 'session_id', 'conversation_id'],
    ['knowledge_items', 'source_session_id', 'source_conversation_id'],
  ] as const) {
    const rows = db.prepare(`SELECT rowid AS row_id, ${from} AS value FROM ${table} WHERE ${from} IS NOT NULL`);
    const update = db.prepare(`UPDATE ${table} SET ${from}=? WHERE rowid=?`);
    for (const row of rows.all() as Iterable<{ row_id: number; value: string }>) {
      const owner = mapping.get(row.value) ?? (db.prepare('SELECT conversation_id FROM conversation_id_map m JOIN transcripts t ON t.session_key=m.conversation_id WHERE t.session_id=?').get(row.value) as { conversation_id: string } | undefined)?.conversation_id;
      if (!owner) throw new Error(`Unresolved ${table}.${from}: ${row.value}`);
      update.run(owner, row.row_id);
    }
    db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
  }

  for (const [table, references] of Object.entries(KEY_COLUMNS)) {
    const present = columns(db, table);
    for (const column of references) {
      if (present.has(column)) db.exec(`ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(column)} TO ${quote(column.replace('session_key', 'conversation_id'))}`);
    }
  }
  for (const [table, names] of Object.entries(TRANSCRIPT_COLUMNS)) {
    const present = columns(db, table);
    for (const [from, to] of Object.entries(names)) {
      if (present.has(from)) db.exec(`ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(from)} TO ${quote(to)}`);
    }
  }

  db.exec(`CREATE VIRTUAL TABLE transcript_fts_next USING fts5(
    content, conversation_id UNINDEXED, transcript_id UNINDEXED, entry_id UNINDEXED, tokenize='unicode61'
  );
  INSERT INTO transcript_fts_next(rowid, content, conversation_id, transcript_id, entry_id)
    SELECT f.rowid, f.content, m.conversation_id, f.session_id, f.entry_id
    FROM transcript_fts f JOIN conversation_id_map m ON m.old_key = f.session_key;`);
  const oldCount = db.prepare('SELECT count(*) AS n FROM transcript_fts').get()!.n;
  const newCount = db.prepare('SELECT count(*) AS n FROM transcript_fts_next').get()!.n;
  if (oldCount !== newCount) throw new Error('Conversation migration lost FTS entries');
  db.exec('DROP TABLE transcript_fts; ALTER TABLE transcript_fts_next RENAME TO transcript_fts;');
  assertForeignKeys(db);
  const mismatched = db.prepare(`SELECT s.conversation_id FROM sessions s LEFT JOIN transcripts t
    ON t.transcript_id = s.active_transcript_id AND t.conversation_id = s.conversation_id
    WHERE t.transcript_id IS NULL LIMIT 1`).get();
  if (mismatched) throw new Error('Conversation migration has an invalid active transcript');
  db.exec('DROP TABLE conversation_id_map');
  return { conversations: sessions.length, historicalOwners: owners.length - sessions.length, routes: sessions.length };
}
