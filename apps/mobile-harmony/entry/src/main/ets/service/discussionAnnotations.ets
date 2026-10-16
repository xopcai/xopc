import { common } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';
import { XopcDiscussionAnnotation, XopcAnnotationInput } from '../model/discussionCapture';
import { XopcDiscussionCaptureRepository } from '../repository/discussionCaptureRepository';
import { gatewaySession } from './gatewaySession';

export interface XopcLocalAnnotation { recordingId: string; annotation: XopcDiscussionAnnotation; state: string; nonce: number; }
export class XopcAnnotationStore {
  private store?: relationalStore.RdbStore;
  private opening?: Promise<void>;
  async initialize(context: common.Context): Promise<void> {
    if (this.store) return;
    if (!this.opening) this.opening = this.open(context);
    await this.opening;
  }
  private async open(context: common.Context): Promise<void> {
    try {
      const db = await relationalStore.getRdbStore(context,{ name: 'xopc-annotations.db',securityLevel: relationalStore.SecurityLevel.S2,encrypt: true });
      await db.executeSql('PRAGMA synchronous=FULL');
      await db.executeSql('CREATE TABLE IF NOT EXISTS annotations (recording_id TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,nonce INTEGER NOT NULL,PRIMARY KEY(recording_id,id))');
      await db.executeSql("CREATE TABLE IF NOT EXISTS review_positions (note_key TEXT PRIMARY KEY,tab TEXT NOT NULL DEFAULT 'summary',position_ms INTEGER NOT NULL DEFAULT 0,source_id TEXT NOT NULL DEFAULT '')");
      this.store = db;
    } finally { this.opening = undefined; }
  }
  private db(): relationalStore.RdbStore { if (!this.store) throw new Error('ANNOTATION_STORE_NOT_INITIALIZED'); return this.store; }
  private key(recordingId: string): string { return (gatewaySession.currentProfile()?.gatewayId ?? '') + ':' + recordingId; }
  async reviewPosition(noteId: string): Promise<XopcReviewPosition | undefined> {
    const rows = await this.db().querySql('SELECT tab,position_ms,source_id FROM review_positions WHERE note_key=?',[this.key(noteId)]);
    try { return rows.goToFirstRow() ? { tab: rows.getString(0),positionMs: rows.getLong(1),sourceId: rows.getString(2) } : undefined; }
    finally { rows.close(); }
  }
  async saveReviewTab(noteId: string,tab: string): Promise<void> {
    await this.db().executeSql('INSERT INTO review_positions(note_key,tab) VALUES(?,?) ON CONFLICT(note_key) DO UPDATE SET tab=excluded.tab',[this.key(noteId),tab]);
  }
  async saveReviewPosition(noteId: string,positionMs: number,sourceId: string): Promise<void> {
    await this.db().executeSql('INSERT INTO review_positions(note_key,position_ms,source_id) VALUES(?,?,?) ON CONFLICT(note_key) DO UPDATE SET position_ms=excluded.position_ms,source_id=excluded.source_id',[this.key(noteId),Math.floor(positionMs),sourceId]);
  }
  async list(recordingId: string): Promise<XopcLocalAnnotation[]> {
    const rows = await this.db().querySql('SELECT payload,state,nonce FROM annotations WHERE recording_id=? ORDER BY id',[this.key(recordingId)]);
    const result: XopcLocalAnnotation[] = [];
    try {
      while (rows.goToNextRow()) result.push({ recordingId: recordingId,annotation: JSON.parse(rows.getString(0)) as XopcDiscussionAnnotation,state: rows.getString(1),nonce: rows.getLong(2) });
      return result;
    } finally { rows.close(); }
  }
  async save(recordingId: string,annotation: XopcDiscussionAnnotation): Promise<void> {
    await this.db().executeSql("INSERT INTO annotations(recording_id,id,payload,state,nonce) VALUES(?,?,?,'pending',1) ON CONFLICT(recording_id,id) DO UPDATE SET payload=excluded.payload,state='pending',nonce=annotations.nonce+1",[this.key(recordingId),annotation.id,JSON.stringify(annotation)]);
  }
  async acknowledge(row: XopcLocalAnnotation,remote: XopcDiscussionAnnotation): Promise<void> {
    await this.db().executeSql("UPDATE annotations SET payload=?,state='synced' WHERE recording_id=? AND id=? AND nonce=?",[JSON.stringify(remote),this.key(row.recordingId),remote.id,row.nonce]);
    const latest = (await this.list(row.recordingId)).find((item: XopcLocalAnnotation): boolean => item.annotation.id === remote.id);
    if (latest && latest.nonce !== row.nonce && latest.annotation.revision === row.annotation.revision) {
      latest.annotation.revision = remote.revision;
      await this.db().executeSql("UPDATE annotations SET payload=? WHERE recording_id=? AND id=? AND nonce=?",[JSON.stringify(latest.annotation),this.key(row.recordingId),remote.id,latest.nonce]);
    }
  }
  async conflict(row: XopcLocalAnnotation): Promise<void> {
    await this.db().executeSql("UPDATE annotations SET state='conflict' WHERE recording_id=? AND id=? AND nonce=?",[this.key(row.recordingId),row.annotation.id,row.nonce]);
  }
}
export class XopcAnnotationSync {
  private tasks: Map<string, Promise<void>> = new Map<string, Promise<void>>();
  private store: XopcAnnotationStore;
  private repository: XopcDiscussionCaptureRepository;
  constructor(store: XopcAnnotationStore,repository: XopcDiscussionCaptureRepository = new XopcDiscussionCaptureRepository()) { this.store = store; this.repository = repository; }
  sync(recordingId: string,discussionId: string): Promise<void> {
    const key = gatewaySession.connectionRevision().toString() + ':' + recordingId + ':' + discussionId;
    const existing = this.tasks.get(key); if (existing) return existing;
    const task = this.run(recordingId,discussionId).finally((): void => { this.tasks.delete(key); });
    this.tasks.set(key,task); return task;
  }
  private async run(recordingId: string,discussionId: string): Promise<void> {
    const connection = gatewaySession.connectionRevision();
    for (let pass: number = 0; pass < 5; pass++) {
    const pending = (await this.store.list(recordingId)).filter((row: XopcLocalAnnotation): boolean => row.state === 'pending');
    if (!pending.length) return;
    for (const row of pending) {
      if (row.state !== 'pending') continue;
      const annotation = row.annotation;
      const input: XopcAnnotationInput = { id: annotation.id,kind: annotation.kind,text: annotation.text,anchor: annotation.anchor,expectedRevision: annotation.revision,deleted: annotation.deleted };
      try {
        const remote = await this.repository.saveAnnotation(discussionId,input); gatewaySession.assertConnection(connection);
        await this.store.acknowledge(row,remote);
      } catch (caught) {
        if ((caught as Error).message.indexOf('409') >= 0) await this.store.conflict(row);
        throw caught as Error;
      }
    }
    }
    throw new Error('ANNOTATIONS_PENDING_RETRY');
  }
}

export interface XopcReviewPosition { tab: string; positionMs: number; sourceId: string; }
