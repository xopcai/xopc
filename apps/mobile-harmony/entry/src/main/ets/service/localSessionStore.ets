import { common } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';
import { gatewaySession } from './gatewaySession';
import { XopcLocalSession, XopcSessionCommand } from '../model/sessionCommand';

export class XopcLocalSessionStore {
  private database?: relationalStore.RdbStore;
  async initialize(context: common.Context): Promise<void> {
    this.database = await relationalStore.getRdbStore(context, {
      name: 'xopc-chat-drafts.db', securityLevel: relationalStore.SecurityLevel.S2, encrypt: true
    });
    await this.database.executeSql('CREATE TABLE IF NOT EXISTS drafts (scope TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope,id))');
    await this.database.executeSql('CREATE TABLE IF NOT EXISTS commands (scope TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope,id))');
    await this.database.executeSql('CREATE TABLE IF NOT EXISTS composers (scope TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  }
  private required(): relationalStore.RdbStore {
    if (!this.database) throw new Error('CHAT_DRAFT_STORE_UNAVAILABLE');
    return this.database;
  }
  scope(): string {
    const profile = gatewaySession.currentProfile();
    if (!profile) throw new Error('GATEWAY_PROFILE_REQUIRED');
    return profile.gatewayId + ':' + profile.deviceId;
  }
  async read(id: string, scope: string = this.scope()): Promise<XopcLocalSession | undefined> {
    const result = await this.required().querySql('SELECT payload FROM drafts WHERE scope=? AND id=?', [scope, id]);
    try {
      if (!result.goToFirstRow()) return undefined;
      return JSON.parse(result.getString(0)) as XopcLocalSession;
    } finally { result.close(); }
  }
  async listProject(projectId: string, scope: string = this.scope()): Promise<XopcLocalSession[]> {
    const result = await this.required().querySql('SELECT payload FROM drafts WHERE scope=?', [scope]);
    const drafts: XopcLocalSession[] = [];
    try {
      while (result.goToNextRow()) {
        const draft = JSON.parse(result.getString(0)) as XopcLocalSession;
        if (draft.creation.projectId === projectId) drafts.push(draft);
      }
    } finally { result.close(); }
    return drafts;
  }
  async save(draft: XopcLocalSession, scope: string): Promise<void> {
    const row: relationalStore.ValuesBucket = { scope, id: draft.conversationId, payload: JSON.stringify(draft) };
    return this.required().insert('drafts', row, relationalStore.ConflictResolution.ON_CONFLICT_REPLACE)
      .then((_rowId: number): void => {});
  }
  async remove(id: string, scope: string): Promise<void> {
    await this.required().delete(new relationalStore.RdbPredicates('drafts').equalTo('scope', scope).and().equalTo('id', id));
  }
  async readCommand(id: string, scope: string): Promise<XopcSessionCommand | undefined> {
    const result = await this.required().querySql('SELECT payload FROM commands WHERE scope=? AND id=?', [scope, id]);
    try { return result.goToFirstRow() ? JSON.parse(result.getString(0)) as XopcSessionCommand : undefined; }
    finally { result.close(); }
  }
  async saveCommand(id: string, command: XopcSessionCommand, scope: string): Promise<void> {
    const row: relationalStore.ValuesBucket = { scope, id, payload: JSON.stringify(command) };
    this.required().insert('commands', row, relationalStore.ConflictResolution.ON_CONFLICT_REPLACE);
  }
  async clearCommand(id: string, scope: string): Promise<void> {
    await this.required().delete(new relationalStore.RdbPredicates('commands').equalTo('scope', scope).and().equalTo('id', id));
  }
  async readComposer(scope: string): Promise<string | undefined> {
    const result = await this.required().querySql('SELECT payload FROM composers WHERE scope=?', [scope]);
    try { return result.goToFirstRow() ? result.getString(0) : undefined; }
    finally { result.close(); }
  }
  async writeComposer(scope: string, payload: string | undefined): Promise<void> {
    if (payload === undefined) {
      await this.required().delete(new relationalStore.RdbPredicates('composers').equalTo('scope', scope));
    } else {
      const row: relationalStore.ValuesBucket = { scope, payload };
      this.required().insert('composers', row, relationalStore.ConflictResolution.ON_CONFLICT_REPLACE);
    }
  }
}
export const localSessionStore: XopcLocalSessionStore = new XopcLocalSessionStore();
