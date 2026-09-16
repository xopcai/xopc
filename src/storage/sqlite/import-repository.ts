import { requireXopcDatabase } from './connection.js';
import type { ImportJob, ImportPlan, ImportScan, ProductImportResult } from '../../imports/types.js';
import { ImportError } from '../../imports/types.js';
type Records = { scan: ImportScan; plan: ImportPlan; job: ImportJob; run: ProductImportResult };
export class ImportRepository {
  constructor(readonly owner: string) {}
  get<K extends keyof Records>(kind: K, id: string): Records[K] {
    const row = requireXopcDatabase().db.prepare('SELECT payload FROM capability_imports WHERE owner = ? AND kind = ? AND id = ?').get(this.owner, kind, id) as { payload: string } | undefined;
    if (!row) throw new ImportError('not_found', 'Import record not found', 404);
    return JSON.parse(row.payload);
  }
  save<K extends keyof Records>(kind: K, value: Records[K], key?: string): void {
    requireXopcDatabase().db.prepare(`INSERT INTO capability_imports(id, owner, kind, created_at, payload, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload WHERE capability_imports.owner = excluded.owner`)
      .run(value.id, this.owner, kind, value.createdAt, JSON.stringify(value), key ?? null);
  }
  byKey(key: string): ImportJob | undefined {
    const row = requireXopcDatabase().db.prepare('SELECT payload FROM capability_imports WHERE owner = ? AND kind = ? AND idempotency_key = ?').get(this.owner, 'job', key) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }
  latestRuns(): ProductImportResult[] {
    return (requireXopcDatabase().db.prepare("SELECT payload FROM capability_imports WHERE owner = ? AND kind = 'run' ORDER BY created_at DESC LIMIT 100")
      .all(this.owner) as Array<{ payload: string }>).map(r => JSON.parse(r.payload));
  }
  static owners(): string[] {
    return (requireXopcDatabase().db.prepare('SELECT DISTINCT owner FROM capability_imports').all() as Array<{ owner: string }>).map(r => r.owner);
  }
  scansBefore(time: number): ImportScan[] {
    return (requireXopcDatabase().db.prepare('SELECT payload FROM capability_imports WHERE owner = ? AND kind = ? AND created_at < ?').all(this.owner, 'scan', time) as Array<{ payload: string }>).map(r => JSON.parse(r.payload));
  }
  jobs(limit = 100): ImportJob[] {
    return (requireXopcDatabase().db.prepare('SELECT payload FROM capability_imports WHERE owner = ? AND kind = ? ORDER BY created_at DESC LIMIT ?').all(this.owner, 'job', limit) as Array<{ payload: string }>).map(r => JSON.parse(r.payload));
  }
}
