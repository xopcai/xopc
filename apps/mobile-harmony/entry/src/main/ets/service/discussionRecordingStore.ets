import { common } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';

export interface XopcLocalRecording {
  id: string;
  gatewayId: string;
  consentVersion: number;
  recordedAt: number;
  discussionId: string;
  noteId: string;
  markers: number[];
  sealRequested?: boolean;
  savedDurationMs?: number;
  recoveryError?: string;
  interruptionCount?: number;
}

export interface XopcLocalRecordingChunk {
  sequence: number;
  startedAtMs: number;
  endedAtMs: number;
  uploaded: boolean;
}

/** Original WAV chunks are immutable SQLite commits, independent of network progress. */
export class XopcDiscussionRecordingStore {
  private store?: relationalStore.RdbStore;
  private initializing?: Promise<void>;

  initialize(context: common.Context): Promise<void> {
    if (this.store) return Promise.resolve();
    if (this.initializing) return this.initializing;
    this.initializing = this.open(context).finally((): void => { this.initializing = undefined; });
    return this.initializing;
  }

  private async open(context: common.Context): Promise<void> {
    const db = await relationalStore.getRdbStore(context, {
      name: 'xopc-recordings.db', securityLevel: relationalStore.SecurityLevel.S2, encrypt: true
    });
    await db.executeSql('PRAGMA synchronous=FULL');
    await db.executeSql('CREATE TABLE IF NOT EXISTS recording_sessions (' +
      'id TEXT PRIMARY KEY, gateway_id TEXT NOT NULL, consent_version INTEGER NOT NULL, recorded_at INTEGER NOT NULL, ' +
      "discussion_id TEXT NOT NULL DEFAULT '', note_id TEXT NOT NULL DEFAULT '', markers TEXT NOT NULL DEFAULT '[]', completed INTEGER NOT NULL DEFAULT 0)");
    await db.executeSql('CREATE TABLE IF NOT EXISTS recording_audio (' +
      'session_id TEXT NOT NULL, sequence INTEGER NOT NULL, started_at_ms INTEGER NOT NULL, ended_at_ms INTEGER NOT NULL, ' +
      'audio BLOB NOT NULL, uploaded INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (session_id, sequence))');
    await db.executeSql('CREATE TABLE IF NOT EXISTS recording_events (session_id TEXT NOT NULL, recorded_at INTEGER NOT NULL, kind TEXT NOT NULL, saved_ms INTEGER NOT NULL)');
    await db.executeSql('CREATE TABLE IF NOT EXISTS recording_consent (gateway_id TEXT PRIMARY KEY, version INTEGER NOT NULL)');
    await db.executeSql('DELETE FROM recording_events WHERE session_id IN (SELECT id FROM recording_sessions WHERE completed=1)');
    await db.executeSql('DELETE FROM recording_audio WHERE session_id IN (SELECT id FROM recording_sessions WHERE completed=1)');
    await db.executeSql('DELETE FROM recording_sessions WHERE completed=1');
    this.store = db;
  }

  async consent(gatewayId: string): Promise<number | undefined> {
    const rows = await this.db().querySql('SELECT version FROM recording_consent WHERE gateway_id=?', [gatewayId]);
    try { return rows.goToFirstRow() ? rows.getLong(0) : undefined; } finally { rows.close(); }
  }

  async saveConsent(gatewayId: string, version: number): Promise<void> {
    await this.db().executeSql('INSERT OR REPLACE INTO recording_consent (gateway_id, version) VALUES (?, ?)', [gatewayId, version]);
  }

  async create(session: XopcLocalRecording): Promise<void> {
    await this.db().executeSql('INSERT INTO recording_sessions (id, gateway_id, consent_version, recorded_at) VALUES (?, ?, ?, ?)',
      [session.id, session.gatewayId, session.consentVersion, session.recordedAt]);
  }

  async pending(gatewayId: string): Promise<XopcLocalRecording[]> {
    const rows = await this.db().querySql('SELECT * FROM recording_sessions WHERE gateway_id=? AND completed=0 ORDER BY recorded_at', [gatewayId]);
    const sessions: XopcLocalRecording[] = [];
    try {
      while (rows.goToNextRow()) {
        sessions.push({ id: rows.getString(rows.getColumnIndex('id')), gatewayId,
          consentVersion: rows.getLong(rows.getColumnIndex('consent_version')),
          recordedAt: rows.getLong(rows.getColumnIndex('recorded_at')),
          discussionId: rows.getString(rows.getColumnIndex('discussion_id')), noteId: rows.getString(rows.getColumnIndex('note_id')),
          markers: JSON.parse(rows.getString(rows.getColumnIndex('markers'))) as number[] });
      }
      for (const session of sessions) {
        const events = await this.events(session.id);
        session.interruptionCount = events.filter((event: XopcRecordingEvent): boolean => event.kind === 'resume').length;
        session.sealRequested = events.some((event: XopcRecordingEvent): boolean => event.kind === 'seal');
        try {
          const chunks = await this.chunks(session.id);
          session.savedDurationMs = chunks.length ? chunks[chunks.length - 1].endedAtMs : 0;
        } catch (caught) { session.recoveryError = (caught as Error).message; }
      }
      return sessions;
    } finally { rows.close(); }
  }

  async event(id: string, kind: string, savedMs: number): Promise<void> {
    await this.db().executeSql('INSERT INTO recording_events (session_id, recorded_at, kind, saved_ms) VALUES (?, ?, ?, ?)', [id, Date.now(), kind, savedMs]);
  }

  async events(id: string): Promise<XopcRecordingEvent[]> {
    const rows = await this.db().querySql('SELECT recorded_at, kind, saved_ms FROM recording_events WHERE session_id=? ORDER BY recorded_at', [id]);
    const events: XopcRecordingEvent[] = [];
    try {
      while (rows.goToNextRow()) events.push({ recordedAt: rows.getLong(0), kind: rows.getString(1), savedMs: rows.getLong(2) });
      return events;
    } finally { rows.close(); }
  }

  async attachServer(id: string, discussionId: string, noteId: string): Promise<void> {
    await this.db().executeSql('UPDATE recording_sessions SET discussion_id=?, note_id=? WHERE id=?', [discussionId, noteId, id]);
  }

  async saveMarkers(id: string, markers: number[]): Promise<void> {
    await this.db().executeSql('UPDATE recording_sessions SET markers=? WHERE id=?', [JSON.stringify(markers), id]);
  }

  async append(id: string, chunk: XopcLocalRecordingChunk, wav: Uint8Array): Promise<void> {
    if (wav.byteLength <= 44 || wav.byteLength > 256 * 1024) throw new Error('INVALID_RECORDING_CHUNK');
    // Metadata and original audio enter storage atomically in one row.
    await this.db().executeSql('INSERT INTO recording_audio (session_id, sequence, started_at_ms, ended_at_ms, audio) VALUES (?, ?, ?, ?, ?)',
      [id, chunk.sequence, chunk.startedAtMs, chunk.endedAtMs, wav]);
  }

  async chunks(id: string, validate: boolean = true): Promise<XopcLocalRecordingChunk[]> {
    const rows = await this.db().querySql('SELECT sequence, started_at_ms, ended_at_ms, uploaded FROM recording_audio WHERE session_id=? ORDER BY sequence', [id]);
    const chunks: XopcLocalRecordingChunk[] = [];
    try {
      while (rows.goToNextRow()) {
        const sequence = rows.getLong(0); const start = rows.getLong(1); const end = rows.getLong(2);
        if (validate && (sequence !== chunks.length || start !== (chunks.length ? chunks[chunks.length - 1].endedAtMs : 0) || end <= start)) {
          throw new Error('RECORDING_CHUNK_GAP');
        }
        chunks.push({ sequence, startedAtMs: start, endedAtMs: end, uploaded: rows.getLong(3) === 1 });
      }
      return chunks;
    } finally { rows.close(); }
  }

  async audio(id: string, sequence: number): Promise<Uint8Array> {
    const rows = await this.db().querySql('SELECT audio FROM recording_audio WHERE session_id=? AND sequence=?', [id, sequence]);
    try {
      if (!rows.goToFirstRow()) throw new Error('RECORDING_CHUNK_MISSING');
      return rows.getBlob(0);
    } finally { rows.close(); }
  }

  async acknowledge(id: string, sequence: number): Promise<void> {
    await this.db().executeSql('UPDATE recording_audio SET uploaded=1 WHERE session_id=? AND sequence=?', [id, sequence]);
  }

  async remove(id: string): Promise<void> {
    // A crash during cleanup must not offer a half-deleted recording for recovery.
    await this.db().executeSql('UPDATE recording_sessions SET completed=1 WHERE id=?', [id]);
    await this.db().executeSql('DELETE FROM recording_audio WHERE session_id=?', [id]);
    await this.db().executeSql('DELETE FROM recording_events WHERE session_id=?', [id]);
    await this.db().executeSql('DELETE FROM recording_sessions WHERE id=?', [id]);
  }

  private db(): relationalStore.RdbStore {
    if (!this.store) throw new Error('RECORDING_STORE_NOT_INITIALIZED');
    return this.store;
  }
}

export interface XopcRecordingEvent { recordedAt: number; kind: string; savedMs: number; }
