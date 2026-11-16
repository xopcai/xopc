import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { SPACE_WORKBOOK_MIME, type SpaceVersionLink } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

const identity = 'native:budget-workbook-demo';
const title = 'Project Budget';
const fileName = 'Project Budget.univer.json';
const workbookId = 'space-project-budget';
export const SPACE_WORKBOOK_MAX_BYTES = 2 * 1024 * 1024;

const worksheetId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(id => !(id in Object.prototype));
const cellIndex = z.string().regex(/^(0|[1-9]\d{0,3})$/);
const cell = z.looseObject({
  v: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  f: z.string().nullable().optional(),
});
const worksheet = z.looseObject({
  id: worksheetId,
  name: z.string().min(1).max(128),
  rowCount: z.number().int().min(1).max(1000),
  columnCount: z.number().int().min(1).max(100),
  cellData: z.record(cellIndex, z.record(cellIndex, cell)),
}).refine(sheet => Object.entries(sheet.cellData).every(([row, columns]) =>
  Number(row) < sheet.rowCount && Object.keys(columns).every(column => Number(column) < sheet.columnCount)));
const workbook = z.looseObject({
  id: worksheetId,
  name: z.string().min(1).max(240),
  sheetOrder: z.array(worksheetId).min(1).max(12),
  sheets: z.record(worksheetId, worksheet),
}).refine(book => new Set(book.sheetOrder).size === book.sheetOrder.length
  && Object.keys(book.sheets).length === book.sheetOrder.length
  && book.sheetOrder.every(id => book.sheets[id]?.id === id));

export const saveSpaceWorkbookSchema = z.object({ baseVersionId: z.uuid(), snapshot: workbook }).strict();
export const createSpaceWorkbookSchema = z.object({
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(240),
  snapshot: workbook,
  source: z.object({ id: z.uuid(), versionId: z.uuid() }).strict().optional(),
}).strict();

export function loadSpaceWorkbook(id: string, versionId?: string) {
  const stored = getSqliteDatabase().prepare(`SELECT i.title, v.body, v.id AS versionId, i.current_version_id AS currentVersionId
    FROM space_items i JOIN space_versions v ON v.item_id = i.id AND v.id = COALESCE(?, i.current_version_id)
    WHERE i.id = ? AND i.trashed_at IS NULL AND v.mime_type = ?`).get(versionId ?? null, id, SPACE_WORKBOOK_MIME);
  if (!stored || typeof stored.body !== 'string') return null;
  return { id, title: String(stored.title), versionId: String(stored.versionId), currentVersionId: String(stored.currentVersionId),
    snapshot: workbook.parse(JSON.parse(stored.body)) };
}

export function findSpaceWorkbookByTitle(title: string) {
  return getSqliteDatabase().prepare(`SELECT i.id, i.title FROM space_items i JOIN space_versions v ON i.current_version_id=v.id
    WHERE i.title = ? COLLATE NOCASE AND i.trashed_at IS NULL AND v.mime_type = ? LIMIT 2`)
    .all(title, SPACE_WORKBOOK_MIME) as { id: string; title: string }[];
}

function budgetSheet(id: string, name: string, rows: (string | number)[][], widths: number[]) {
  return {
    id, name, rowCount: 50, columnCount: 12,
    columnData: Object.fromEntries(widths.map((w, column) => [column, { w }])),
    cellData: Object.fromEntries(rows.map((row, rowIndex) => [rowIndex, Object.fromEntries(row.map((value, column) => [column,
      typeof value === 'string' && value.startsWith('=') ? { f: value } : { v: value, ...(rowIndex === 0 ? { s: 'heading' } : {}) },
    ]))])),
  };
}

function initialSnapshot(): string {
  const budget = [
    { category: 'Personnel', planned: 8000, spent: 7800 },
    { category: 'Software', planned: 2400, spent: 2600 },
    { category: 'Travel', planned: 1600, spent: 1100 },
  ];
  const plan = budgetSheet('plan', 'Plan', [
    ['Category', 'Budget'], ...budget.map(({ category, planned }) => [category, planned]),
    ['Total', '=SUM(B2:B4)'],
  ], [124, 92]);
  const actual = budgetSheet('actual', 'Actual', [
    ['Category', 'Spent'], ...budget.map(({ category, spent }) => [category, spent]),
    ['Total', '=SUM(B2:B4)'],
  ], [124, 92]);
  const summary = budgetSheet('summary', 'Summary', [
    ['Category', 'Budget', 'Spent', 'Remaining'],
    ...[...budget.map(({ category }) => category), 'Total'].map((category, index) => {
      const row = index + 2;
      return [category, `=Plan!B${row}`, `=Actual!B${row}`, `=B${row}-C${row}`];
    }),
  ], [124, 92, 92, 106]);
  return JSON.stringify({
    id: workbookId, name: title, appVersion: '1.5.0', locale: 'enUS',
    styles: { heading: { bl: 1 } },
    sheetOrder: [summary.id, plan.id, actual.id], sheets: { summary, plan, actual },
  });
}

function insertWorkbookVersion(db: DatabaseSync, id: string, name: string, body: string, now: number, versionId = randomUUID()): string {
  const sha256 = createHash('sha256').update(body).digest('hex');
  db.prepare(`INSERT INTO space_versions(id, item_id, ordinal, file_name, mime_type, size_bytes, body, sha256, index_status, created_at)
    VALUES (?, ?, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM space_versions WHERE item_id = ?), ?, ?, ?, ?, ?, 'unsupported', ?)`)
    .run(versionId, id, id, name, SPACE_WORKBOOK_MIME, Buffer.byteLength(body), body, sha256, now);
  return versionId;
}

export function openSpaceBudgetWorkbook(): SpaceVersionLink | 'trashed' {
  return runSqliteWriteTransaction(db => {
    const item = db.prepare('SELECT id, current_version_id, trashed_at FROM space_items WHERE identity_key = ?').get(identity);
    if (item) return item.trashed_at !== null ? 'trashed' : { id: String(item.id), versionId: String(item.current_version_id) };

    const id = randomUUID();
    const versionId = randomUUID();
    const now = Date.now();
    db.prepare("INSERT INTO space_items(id, identity_key, title, kind, current_version_id, updated_at) VALUES (?, ?, ?, 'spreadsheet', ?, ?)")
      .run(id, identity, title, versionId, now);
    insertWorkbookVersion(db, id, fileName, initialSnapshot(), now, versionId);
    return { id, versionId };
  });
}

export function createSpaceWorkbook(input: z.infer<typeof createSpaceWorkbookSchema>): SpaceVersionLink | 'conflict' {
  const key = `native:workbook:${input.requestId}`;
  return runSqliteWriteTransaction(db => {
    const existing = db.prepare('SELECT id, current_version_id, trashed_at FROM space_items WHERE identity_key = ?').get(key);
    if (existing) return existing.trashed_at !== null ? 'conflict' : { id: String(existing.id), versionId: String(existing.current_version_id) };
    if (input.source && !db.prepare(`SELECT 1 FROM space_versions v JOIN space_items i ON i.id = v.item_id
      WHERE i.id = ? AND v.id = ? AND i.trashed_at IS NULL`).get(input.source.id, input.source.versionId)) return 'conflict';

    const id = randomUUID();
    const versionId = randomUUID();
    const now = Date.now();
    const name = `${input.title.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 120)}.univer.json`;
    const body = JSON.stringify({ ...input.snapshot, id: `workbook-${input.requestId}`, name: input.title });
    db.prepare("INSERT INTO space_items(id, identity_key, title, kind, current_version_id, updated_at) VALUES (?, ?, ?, 'spreadsheet', ?, ?)")
      .run(id, key, input.title, versionId, now);
    insertWorkbookVersion(db, id, name, body, now, versionId);
    if (input.source) {
      db.prepare(`INSERT INTO space_origins (source_key, item_id, version_id, kind, conversation_id, transcript_id,
        entry_id, project_id, task_id, automation_run_id, label)
        SELECT 'workbook-copy:' || ? || ':' || source_key, ?, ?, kind, conversation_id, transcript_id,
          entry_id, project_id, task_id, automation_run_id, label
        FROM space_origins WHERE item_id = ? AND version_id = ? AND source_key NOT LIKE 'media:%'`)
        .run(id, id, versionId, input.source.id, input.source.versionId);
    }
    return { id, versionId };
  });
}

export function saveSpaceWorkbook(id: string, input: z.infer<typeof saveSpaceWorkbookSchema>): SpaceVersionLink | 'missing' | 'conflict' {
  const body = JSON.stringify(input.snapshot);
  if (Buffer.byteLength(body) > SPACE_WORKBOOK_MAX_BYTES) throw new Error('Workbook snapshot exceeds the storage limit');
  return runSqliteWriteTransaction(db => {
    const current = db.prepare(`SELECT i.identity_key, i.current_version_id, i.trashed_at, v.created_at, v.body, v.file_name
      FROM space_items i JOIN space_versions v ON i.current_version_id = v.id
      WHERE i.id = ? AND v.mime_type = ?`).get(id, SPACE_WORKBOOK_MIME);
    if (!current) return 'missing';
    if (current.trashed_at !== null) return 'conflict';
    const expectedId = current.identity_key === identity ? workbookId : `workbook-${String(current.identity_key).slice('native:workbook:'.length)}`;
    if (input.snapshot.id !== expectedId) return 'conflict';
    if (current.body === body) return { id, versionId: String(current.current_version_id) };
    if (current.current_version_id !== input.baseVersionId) return 'conflict';

    const now = Math.max(Date.now(), Number(current.created_at));
    const versionId = insertWorkbookVersion(db, id, String(current.file_name), body, now);
    db.prepare('UPDATE space_items SET current_version_id = ?, updated_at = ?, revision = revision + 1 WHERE id = ?')
      .run(versionId, now, id);
    return { id, versionId };
  });
}

export function undoSpaceWorkbookVersion(id: string, versionId: string, sourceVersionId: string) {
  return runSqliteWriteTransaction(db => {
    const prior = db.prepare(`SELECT p.body FROM space_items i
      JOIN space_versions current ON current.id = i.current_version_id
      JOIN space_versions p ON p.item_id = i.id AND p.ordinal = current.ordinal - 1
      WHERE i.id = ? AND i.trashed_at IS NULL AND current.id = ? AND p.id = ? AND p.mime_type = ?`)
      .get(id, versionId, sourceVersionId, SPACE_WORKBOOK_MIME);
    if (typeof prior?.body !== 'string') return 'conflict';
    return saveSpaceWorkbook(id, saveSpaceWorkbookSchema.parse({ baseVersionId: versionId, snapshot: JSON.parse(prior.body) }));
  });
}
