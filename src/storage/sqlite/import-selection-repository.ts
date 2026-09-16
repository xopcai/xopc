import { requireXopcDatabase } from './connection.js';
import { ImportError, type StoredInventory, type ProductImportResult } from '../../imports/types.js';
type Records = { inventory: StoredInventory; run: ProductImportResult };
export class ImportSelectionRepository {
  constructor(readonly owner: string) {}
  get<K extends keyof Records>(kind: K, id: string): Records[K] {
    const row = requireXopcDatabase().db.prepare('SELECT payload FROM import_selections WHERE owner = ? AND kind = ? AND id = ?')
      .get(this.owner, kind, id) as { payload: string } | undefined;
    if (!row) throw new ImportError('not_found', 'Import record not found', 404);
    return JSON.parse(row.payload);
  }
  save<K extends keyof Records>(kind: K, value: Records[K]): void {
    const result = requireXopcDatabase().db.prepare(`INSERT INTO import_selections(id, owner, kind, created_at, payload) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload WHERE import_selections.owner = excluded.owner AND import_selections.kind = excluded.kind`)
      .run(value.id, this.owner, kind, value.createdAt, JSON.stringify(value));
    if (!result.changes) throw new ImportError('conflict', 'Import ID is already in use', 409);
  }
  list<K extends keyof Records>(kind: K): Records[K][] {
    return (requireXopcDatabase().db.prepare('SELECT payload FROM import_selections WHERE owner = ? AND kind = ? ORDER BY created_at DESC')
      .all(this.owner, kind) as Array<{ payload: string }>).map(r => JSON.parse(r.payload));
  }
  deleteInventory(id: string): void {
    requireXopcDatabase().db.prepare("DELETE FROM import_selections WHERE owner = ? AND kind = 'inventory' AND id = ?").run(this.owner, id);
  }
  static owners(): string[] {
    return (requireXopcDatabase().db.prepare('SELECT DISTINCT owner FROM import_selections').all() as Array<{ owner: string }>).map(r => r.owner);
  }
}
