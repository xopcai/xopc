import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { parseTaskResultDelivery } from '@xopcai/gateway-contract';

import { deleteMediaUris } from '../media/session-references.js';
import { resolveMediaBufferPath } from '../media/store.js';
import { buildMediaUri } from '../media/uri.js';
import type { extractResult } from '../personal-agent/result-extraction.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import { archiveSpaceGeneratedMedia, archiveSpaceTaskDelivery, archiveSpaceTurn } from './ingest.js';
import { purgeSpaceItem, spaceHanPairs, SPACE_TRASH_RETENTION_MS } from './repository.js';

const log = createLogger('Space');
const require = createRequire(import.meta.url);
type Extraction = Awaited<ReturnType<typeof extractResult>>;
type PendingVersion = { id: string; media_id: string | null; body: string | null; file_name: string; mime_type: string; sha256: string | null };

function backfill(source: 'turn' | 'task' | 'music' | 'video'): void {
  const db = getSqliteDatabase();
  const progress = db.prepare('SELECT cursor, complete FROM space_backfill WHERE source = ?').get(source);
  if (progress?.complete === 1) return;
  const cursor = Number(progress?.cursor ?? 0);
  const table = { turn: 'transcript_entries', task: 'task_result_deliveries', music: 'music_generation_jobs', video: 'video_generation_jobs' }[source];
  const next = db.prepare(`SELECT rowid FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT 100`).all(cursor);
  const last = Number(next.at(-1)?.rowid ?? cursor);
  runSqliteWriteTransaction(db => {
    if (source === 'turn') {
      const rows = db.prepare(`SELECT e.entry_id, e.transcript_id, t.conversation_id, e.created_at, e.payload_json
        FROM transcript_entries e JOIN transcripts t ON t.transcript_id = e.transcript_id
        WHERE e.rowid > ? AND e.rowid <= ? AND e.payload_json LIKE '%"turn_outcome"%'
          AND CASE WHEN json_valid(e.payload_json) THEN json_extract(e.payload_json, '$.customType') END = 'turn_outcome' ORDER BY e.rowid`).all(cursor, last);
      for (const row of rows) archiveSpaceTurn(db, {
        conversationId: String(row.conversation_id), transcriptId: String(row.transcript_id),
        entryId: String(row.entry_id), createdAt: Number(row.created_at), outcome: JSON.parse(String(row.payload_json)).data,
      });
    } else if (source === 'task') {
      const rows = db.prepare(`SELECT payload_json, message_entry_id FROM task_result_deliveries
        WHERE rowid > ? AND rowid <= ? AND status = 'delivered' AND json_valid(payload_json) ORDER BY rowid`).all(cursor, last);
      for (const row of rows) {
        const delivery = parseTaskResultDelivery(JSON.parse(String(row.payload_json)));
        if (delivery) archiveSpaceTaskDelivery(db, delivery, typeof row.message_entry_id === 'string' ? row.message_entry_id : undefined);
      }
    }
    if (source === 'music' || source === 'video') {
      const rows = db.prepare(`SELECT id FROM ${table} WHERE rowid > ? AND rowid <= ? AND state = 'completed'`).all(cursor, last);
      for (const row of rows) archiveSpaceGeneratedMedia(db, source, String(row.id));
    }
    db.prepare(`INSERT INTO space_backfill(source, cursor, complete) VALUES (?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET cursor = excluded.cursor, complete = excluded.complete`)
      .run(source, last, Number(next.length < 100));
  });
}

function storeIndex(id: string, result: Extraction): void {
  runSqliteWriteTransaction(db => {
    const version = db.prepare("SELECT 1 FROM space_versions WHERE id = ? AND index_status = 'pending'").get(id);
    if (!version) return;
    db.prepare('UPDATE space_versions SET index_status = ? WHERE id = ?').run(result.unsupported ? 'unsupported' : 'ready', id);
    if (result.unsupported) return;
    const add = db.prepare('INSERT INTO space_search(version_id, body, locator) VALUES (?, ?, ?)');
    const addShort = db.prepare('INSERT INTO space_search_short(version_id, terms, body, locator) VALUES (?, ?, ?, ?)');
    // Bound index size per version. Preserve a small overlap so phrases spanning chunks remain searchable.
    const characters = Array.from(result.text.slice(0, 300_000));
    for (const section of result.sections) {
      const end = Math.min(characters.length, section.offset + section.length);
      for (let offset = section.offset; offset < end; offset += 720) {
        const text = characters.slice(offset, Math.min(end, offset + 800)).join('').normalize('NFKC').trim();
        if (!text) continue;
        const locator = JSON.stringify(section.locator);
        add.run(id, text, locator);
        const terms = spaceHanPairs(text);
        if (terms) addShort.run(id, terms, text, locator);
      }
    }
  });
}

export class SpaceWorker {
  private timer?: ReturnType<typeof setInterval>;
  private parser?: Worker;
  private maintenance?: Promise<void>;
  private indexing?: Promise<void>;
  private preferNewest = true;
  private checkedPdfRecovery = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 500);
    this.timer.unref();
    this.tick();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.parser) await this.parser.terminate();
    await Promise.all([this.maintenance, this.indexing]);
  }

  private tick(): void {
    // Slow document parsing must not delay historical discovery or trash cleanup.
    this.maintenance ??= this.maintain().catch(err => log.warn({ err }, 'Space maintenance failed'))
      .finally(() => { this.maintenance = undefined; });
    this.indexing ??= this.indexNext().catch(err => log.warn({ err }, 'Space index iteration failed'))
      .finally(() => { this.indexing = undefined; });
  }

  private async maintain(): Promise<void> {
    if (!this.checkedPdfRecovery) {
      runSqliteWriteTransaction(db => {
        const firstRun = db.prepare("INSERT OR IGNORE INTO space_backfill(source, cursor, complete) VALUES ('pdf-loader-recovery', 0, 1)").run();
        if (firstRun.changes) db.prepare(`UPDATE space_versions SET index_status = 'pending'
          WHERE index_status = 'failed' AND (mime_type = 'application/pdf' OR lower(file_name) LIKE '%.pdf')`).run();
      });
      this.checkedPdfRecovery = true;
    }
    backfill('turn');
    backfill('task');
    backfill('music');
    backfill('video');
    const db = getSqliteDatabase();
    const expired = db.prepare('SELECT id, revision FROM space_items WHERE trashed_at <= ? LIMIT 10').all(Date.now() - SPACE_TRASH_RETENTION_MS);
    for (const row of expired) purgeSpaceItem(String(row.id), Number(row.revision));
    const cleanup = db.prepare('SELECT media_id FROM space_media_cleanup LIMIT 10').all();
    for (const row of cleanup) {
      await deleteMediaUris([buildMediaUri('outbound', String(row.media_id))], { strict: true });
      db.prepare('DELETE FROM space_media_cleanup WHERE media_id = ?').run(row.media_id);
    }
  }

  private async indexNext(): Promise<void> {
    const db = getSqliteDatabase();
    const direction = this.preferNewest ? 'DESC' : 'ASC';
    const row = db.prepare(`SELECT id, media_id, body, file_name, mime_type, sha256 FROM space_versions
      WHERE index_status = 'pending' ORDER BY created_at ${direction}, rowid ${direction} LIMIT 1`).get() as PendingVersion | undefined;
    if (!row) return;
    // Alternate ends of the queue so recent deliveries and the historical backlog both progress.
    this.preferNewest = !this.preferNewest;
    if (/^(?:audio|video|image)\//i.test(row.mime_type)) {
      db.prepare("UPDATE space_versions SET index_status = 'unsupported' WHERE id = ?").run(row.id);
    } else {
      await this.index(row);
    }
  }

  private async index(row: PendingVersion): Promise<void> {
    const bundled = new URL('./result-extraction.js', import.meta.url);
    const compiled = existsSync(fileURLToPath(bundled))
      ? bundled
      : new URL('../personal-agent/result-extraction.js', import.meta.url);
    const source = existsSync(fileURLToPath(compiled)) ? compiled.href : new URL('../personal-agent/result-extraction.ts', import.meta.url).href;
    const input = { title: row.file_name, mimeType: row.mime_type, text: row.body ?? undefined,
      file: row.media_id ? resolveMediaBufferPath(row.media_id, 'outbound') : undefined, expectedSha256: row.sha256 ?? undefined };
    try {
      const worker = new Worker(`
        const { workerData, parentPort } = require('node:worker_threads');
        (async () => {
          const module = workerData.tsx
            ? await require(workerData.tsx).tsImport(workerData.source, workerData.source)
            : await import(workerData.source);
          const result = await module.extractResult(workerData.input);
          if (!result.unsupported) result.text = result.text.slice(0, 300000);
          parentPort.postMessage(result);
        })().catch(error => { throw error; });
      `, { eval: true, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 },
        workerData: { source, input, ...(source.endsWith('.ts') ? { tsx: require.resolve('tsx/esm/api') } : {}) } });
      this.parser = worker;
      const deadline = setTimeout(() => void worker.terminate(), 45_000);
      deadline.unref();
      try {
        const result = await new Promise<Extraction>((resolve, reject) => {
          worker.once('message', resolve);
          worker.once('error', reject);
          worker.once('exit', () => reject(new Error('Space parser stopped before returning a result')));
        });
        storeIndex(row.id, result);
      } finally {
        clearTimeout(deadline);
        this.parser = undefined;
        await worker.terminate();
      }
    } catch (err) {
      if (!this.timer) return;
      getSqliteDatabase().prepare("UPDATE space_versions SET index_status = 'failed' WHERE id = ? AND index_status = 'pending'").run(row.id);
      log.warn({ err, versionId: row.id }, 'Space text extraction failed');
    }
  }
}
