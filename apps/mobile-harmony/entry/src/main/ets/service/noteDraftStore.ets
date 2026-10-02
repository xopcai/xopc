import { common } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';
import { XopcNoteDraft, XopcNoteSyncState } from '../model/note';

const NOTE_DATABASE = 'xopc-notes.db';
const NOTE_DRAFT_TABLE = 'note_drafts';
const CREATE_NOTE_DRAFT_TABLE = 'CREATE TABLE IF NOT EXISTS note_drafts ('
  + 'note_id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL, base_revision INTEGER NOT NULL, '
  + 'local_version INTEGER NOT NULL, updated_at INTEGER NOT NULL, sync_state TEXT NOT NULL, mutation_id TEXT NOT NULL, '
  + 'project_id TEXT)';

/** Encrypted local draft store. It is the single durability boundary for unsynchronized note edits. */
export class XopcNoteDraftStore {
  private store?: relationalStore.RdbStore;

  async initialize(context: common.Context): Promise<void> {
    if (this.store) return;
    this.store = await relationalStore.getRdbStore(context, {
      name: NOTE_DATABASE, securityLevel: relationalStore.SecurityLevel.S2, encrypt: true
    });
    await this.store.executeSql(CREATE_NOTE_DRAFT_TABLE);
    try { await this.store.executeSql('ALTER TABLE note_drafts ADD COLUMN project_id TEXT'); }
    catch (error) {
      if (!(error as Error).message.toLowerCase().includes('duplicate column')) throw error as Error;
    }
  }

  async save(draft: XopcNoteDraft): Promise<void> {
    const store = this.requiredStore();
    const values: relationalStore.ValuesBucket = {
      note_id: draft.noteId, title: draft.title, markdown: draft.markdown,
      base_revision: draft.baseRevision, local_version: draft.localVersion,
      updated_at: draft.updatedAt, sync_state: draft.syncState, mutation_id: draft.mutationId,
      project_id: draft.projectId ?? null
    };
    store.insert(NOTE_DRAFT_TABLE, values, relationalStore.ConflictResolution.ON_CONFLICT_REPLACE);
  }

  async load(noteId: string): Promise<XopcNoteDraft | undefined> {
    const store = this.requiredStore();
    const predicates = new relationalStore.RdbPredicates(NOTE_DRAFT_TABLE).equalTo('note_id', noteId);
    const result = await store.query(predicates);
    try {
      if (!result.goToFirstRow()) return undefined;
      const state = result.getString(result.getColumnIndex('sync_state')) as XopcNoteSyncState;
      return {
        noteId: result.getString(result.getColumnIndex('note_id')),
        projectId: result.getString(result.getColumnIndex('project_id')) || undefined,
        title: result.getString(result.getColumnIndex('title')),
        markdown: result.getString(result.getColumnIndex('markdown')),
        baseRevision: result.getLong(result.getColumnIndex('base_revision')),
        localVersion: result.getLong(result.getColumnIndex('local_version')),
        updatedAt: result.getLong(result.getColumnIndex('updated_at')),
        syncState: state,
        mutationId: result.getString(result.getColumnIndex('mutation_id'))
      };
    } finally { result.close(); }
  }

  async pending(): Promise<XopcNoteDraft[]> {
    const store = this.requiredStore();
    const result = await store.querySql('SELECT * FROM note_drafts WHERE sync_state != ? ORDER BY updated_at ASC', ['clean']);
    const drafts: XopcNoteDraft[] = [];
    try {
      while (result.goToNextRow()) {
        drafts.push({
          noteId: result.getString(result.getColumnIndex('note_id')),
          projectId: result.getString(result.getColumnIndex('project_id')) || undefined,
          title: result.getString(result.getColumnIndex('title')),
          markdown: result.getString(result.getColumnIndex('markdown')),
          baseRevision: result.getLong(result.getColumnIndex('base_revision')),
          localVersion: result.getLong(result.getColumnIndex('local_version')),
          updatedAt: result.getLong(result.getColumnIndex('updated_at')),
          syncState: result.getString(result.getColumnIndex('sync_state')) as XopcNoteSyncState,
          mutationId: result.getString(result.getColumnIndex('mutation_id'))
        });
      }
      return drafts;
    } finally { result.close(); }
  }

  async remove(noteId: string): Promise<void> {
    const predicates = new relationalStore.RdbPredicates(NOTE_DRAFT_TABLE).equalTo('note_id', noteId);
    await this.requiredStore().delete(predicates);
  }

  private requiredStore(): relationalStore.RdbStore {
    if (!this.store) throw new Error('NOTE_STORE_NOT_INITIALIZED');
    return this.store;
  }
}
