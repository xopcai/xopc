import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { TaskResultDeliverySchema, type TaskResultDelivery } from '@xopcai/gateway-contract';

import { canAccessConnectorAccount } from '../connectors/account-access.js';
import { connectorPrincipalForSession } from '../connectors/principal.js';
import { resolveMediaReference } from '../media/media-reference.js';
import { getConnectorAccount } from '../storage/sqlite/connector-account-repository.js';
import { getConnectorConnection, getConnectorInstallation } from '../storage/sqlite/connector-repository.js';
import { readCurrentTranscriptId } from '../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import { personalRequestForTask } from './request-repository.js';
import { isPersonalConversation } from './repository.js';
import type { ResultPreparation, ResultSection } from './result-extraction.js';

const PARSER_VERSION = 1;
const workers = new Map<string, Worker>();
const shuttingDownWorkers = new WeakSet<Worker>();
const log = createLogger('PersonalResultRead');
let preparationGeneration = 0;
const require = createRequire(import.meta.url);
type DeliveryRow = { delivery_id: string; payload_json: string; reply_payload_json: string | null; status: string };
type DocumentRow = { document_id: string; status: string; content_revision: string | null; sections_json: string;
  limitations_json: string; fingerprint: string | null; error: string | null; length: number; lease_until: number };
export interface PersonalResultInput {
  command: 'list' | 'get' | 'read' | 'search'; resultId?: string; taskId?: string; sourceId?: string;
  revision?: string; sectionId?: string; offset?: number; limit?: number; query?: string; cursor?: string;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function databasePath(): string {
  return (getSqliteDatabase().prepare('PRAGMA database_list').all() as Array<{ name: string; file: string }>).find(row => row.name === 'main')!.file;
}

function assertAccess(conversationId: string, delivery: Pick<TaskResultDelivery, 'taskId' | 'conversationId'>): void {
  const db = getSqliteDatabase();
  if (!isPersonalConversation(conversationId) || delivery.conversationId !== conversationId
    || !readCurrentTranscriptId(db, conversationId)
    || !db.prepare('SELECT 1 FROM task_origin_links WHERE task_id = ? AND conversation_id = ?').get(delivery.taskId, conversationId)) {
    throw new Error('Result is unavailable in this conversation');
  }
  const request = personalRequestForTask(delivery.taskId);
  if (!request) return;
  const principal = connectorPrincipalForSession(conversationId);
  const account = request.accountId ? getConnectorAccount(request.accountId) : undefined;
  const connection = account?.currentConnectionId ? getConnectorConnection(account.currentConnectionId) : undefined;
  const installation = getConnectorInstallation(`${request.connectorId}-${principal.principalId}`);
  if (request.state === 'cancelled' || request.transcriptId !== readCurrentTranscriptId(db, conversationId)
    || !principal.isLocalOwner || !installation || !connection || connection.status !== 'active' || account?.connectorId !== request.connectorId
    || !canAccessConnectorAccount(connection, installation, principal.agentId)
    || !canAccessConnectorAccount(connection, installation, request.executorAgentId)) throw new Error('Result account access is no longer available');
}

function resolve(conversationId: string, resultId: string) {
  const row = getSqliteDatabase().prepare(`SELECT delivery_id, payload_json, reply_payload_json, status FROM task_result_deliveries
    WHERE delivery_id = ? AND conversation_id = ? AND status IN ('pending','delivered','stale','failed')`).get(resultId, conversationId) as DeliveryRow | undefined;
  if (!row) throw new Error('Result is unavailable in this conversation');
  const delivery = TaskResultDeliverySchema.parse(JSON.parse(row.payload_json));
  assertAccess(conversationId, delivery);
  return { row, delivery };
}

/** A delegated reader must retain the source account's current Agent access restrictions. */
export function assertPersonalResultDelegateAccess(conversationId: string, delivery: TaskResultDelivery, agentId: string): void {
  assertAccess(conversationId, delivery);
  const request = personalRequestForTask(delivery.taskId);
  if (!request) return;
  const principal = connectorPrincipalForSession(conversationId);
  const account = request.accountId ? getConnectorAccount(request.accountId) : undefined;
  const connection = account?.currentConnectionId ? getConnectorConnection(account.currentConnectionId) : undefined;
  const installation = getConnectorInstallation(`${request.connectorId}-${principal.principalId}`);
  if (!connection || !installation || !canAccessConnectorAccount(connection, installation, agentId)) throw new Error('Result account access does not permit this Task executor');
}

export function resolvePersonalResultReference(conversationId: string, resultId: string): TaskResultDelivery {
  return resolve(conversationId, resultId).delivery;
}

/** Retry only an exhausted delivery outbox; never reopen execution, parsing, or a historical revision. */
export function retryPersonalResultDelivery(conversationId: string, resultId: string): Record<string, unknown> {
  const { delivery } = resolve(conversationId, resultId);
  return runSqliteWriteTransaction(db => {
    const task = db.prepare('SELECT latest_contract_version, resolution FROM tasks WHERE task_id = ?').get(delivery.taskId) as { latest_contract_version: number; resolution: string | null };
    const latest = db.prepare('SELECT run_id, status FROM task_runs WHERE task_id = ? AND parent_run_id IS NULL ORDER BY queued_at DESC, rowid DESC LIMIT 1')
      .get(delivery.taskId) as { run_id: string; status: string } | undefined;
    if (!latest || latest.run_id !== delivery.taskRunId || !['succeeded','failed'].includes(latest.status)
      || task.resolution && task.resolution !== 'done' || delivery.contractVersion !== undefined && delivery.contractVersion !== task.latest_contract_version
      || delivery.instructionSequence !== undefined && delivery.instructionSequence !== Number(db.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM task_collaboration_entries WHERE task_id = ? AND author_kind IN ('main_agent','user') AND kind IN ('instruction','answer')").get(delivery.taskId)?.n ?? 0)) {
      return { retryQueued: false, resultId, reason: 'historical_or_changed_requirements', guidance: 'Read this historical result. Do not resend it as the completion of newer or cancelled work.' };
    }
    const row = db.prepare('SELECT status, notified_at, reply_attempts, reply_notified_at FROM task_result_deliveries WHERE delivery_id = ?').get(resultId) as {
      status: string; notified_at: number | null; reply_attempts: number; reply_notified_at: number | null };
    if (row.status !== 'failed' && row.notified_at !== -1 && row.reply_attempts < 8 && row.reply_notified_at !== -1) return { retryQueued: false, resultId, reason: 'already_pending_or_delivered' };
    db.prepare(`UPDATE task_result_deliveries SET status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END,
      attempts = 0, next_attempt_at = 0, last_error = NULL, notified_at = CASE WHEN status = 'failed' OR notified_at = -1 THEN NULL ELSE notified_at END,
      reply_attempts = 0, reply_next_attempt_at = 0, reply_last_error = NULL, reply_lease_until = 0, reply_lease_token = NULL,
      reply_notified_at = CASE WHEN reply_notified_at = -1 THEN NULL ELSE reply_notified_at END WHERE delivery_id = ?`).run(resultId);
    return { retryQueued: true, resultId, taskId: delivery.taskId, scope: 'delivery_only', executionRestarted: false };
  });
}

/** Metadata-only directory; no extraction, model calls or file IO on the prompt path. */
export function listPersonalResults(conversationId: string, options: { taskId?: string; limit?: number; offset?: number } = {}) {
  const db = getSqliteDatabase();
  const limit = Math.min(10, Math.max(1, options.limit ?? 5));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = db.prepare(`SELECT delivery_id, json_extract(payload_json, '$.taskId') AS taskId,
    json_extract(payload_json, '$.taskTitle') AS title, json_extract(payload_json, '$.taskRunId') AS runId,
    status AS deliveryState, json_extract(payload_json, '$.assignmentEpoch') AS assignmentEpoch, json_extract(payload_json, '$.outcome.outcomeId') AS outcomeId,
    json_extract(payload_json, '$.outcome.status') AS status, json_extract(payload_json, '$.resultRevision') AS resultRevision,
    json_extract(payload_json, '$.previousResultId') AS previousResultId, created_at AS createdAt
    FROM task_result_deliveries WHERE conversation_id = ? AND status IN ('pending','delivered','stale','failed')
    AND (? IS NULL OR json_extract(payload_json, '$.taskId') = ?)
    ORDER BY created_at DESC, delivery_id DESC LIMIT ? OFFSET ?`)
    .all(conversationId, options.taskId ?? null, options.taskId ?? null, limit + 1, offset) as Array<Record<string, unknown>>;
  const visible = rows.slice(0, limit).flatMap(row => {
    try { assertAccess(conversationId, { taskId: String(row.taskId), conversationId }); return [{ resultId: String(row.delivery_id), taskId: row.taskId,
      title: String(row.title).slice(0, 200), runId: row.runId, status: row.status, deliveryState: row.deliveryState, baselineVersion: `${row.runId}:${row.assignmentEpoch}:${row.outcomeId}`, resultRevision: row.resultRevision ?? 1, previousResultId: row.previousResultId, createdAt: row.createdAt }]; }
    catch { return []; }
  });
  return { items: visible, ...(rows.length > limit ? { nextOffset: offset + limit } : {}), offset };
}

function documentRow(documentId: string): DocumentRow | undefined {
  return getSqliteDatabase().prepare(`SELECT document_id, status, content_revision, sections_json, limitations_json, fingerprint,
    error, length(content) AS length, lease_until FROM personal_result_documents WHERE document_id = ?`).get(documentId) as DocumentRow | undefined;
}

function launch(input: ResultPreparation): boolean {
  if (workers.size >= 2) return false;
  const entry = new URL('./result-extraction.js', import.meta.url);
  const source = existsSync(fileURLToPath(entry)) ? entry.href : new URL('./result-extraction.ts', import.meta.url).href;
  const worker = new Worker(`
    const { workerData, parentPort } = require('node:worker_threads');
    (async () => {
      const module = workerData.source.endsWith('.ts')
        ? await require(workerData.tsx).tsImport(workerData.source, workerData.source)
        : await import(workerData.source);
      await module.prepareResultDocument(workerData.input);
      parentPort.postMessage('complete');
    })().catch(error => { throw error; });
  `, { eval: true, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 },
    workerData: { source, ...(source.endsWith('.ts') ? { tsx: require.resolve('tsx/esm/api') } : {}), input } });
  const key = `${input.database}:${input.documentId}`;
  workers.set(key, worker);
  const fail = (err?: Error) => {
    if (shuttingDownWorkers.has(worker)) return;
    try {
      const changed = getSqliteDatabase().prepare(`UPDATE personal_result_documents SET status = 'failed', error = ?,
        lease_until = 0 WHERE document_id = ? AND status = 'pending' AND lease_token = ?`)
        .run((err?.message ?? 'Background preparation stopped').slice(0, 500), input.documentId, input.lease);
      if (changed.changes) log.warn({ err, documentId: input.documentId, phase: 'result_preparation' }, 'Background result preparation stopped');
    } catch { /* A closed database recovers through its lease. */ }
  };
  const timer = setTimeout(() => { fail(); void worker.terminate(); }, 45_000);
  timer.unref();
  worker.once('error', fail);
  worker.once('exit', () => { clearTimeout(timer); workers.delete(key); fail(); });
  worker.unref();
  return true;
}

export async function stopPersonalResultPreparations(): Promise<void> {
  preparationGeneration++;
  for (const worker of workers.values()) shuttingDownWorkers.add(worker);
  try { getSqliteDatabase().prepare("UPDATE personal_result_documents SET lease_until = 0 WHERE status = 'pending' AND lease_token LIKE ?")
    .run(`${process.pid}:%`); } catch { /* Startup can recover an expired lease. */ }
  await Promise.all([...workers.values()].map(worker => worker.terminate()));
  workers.clear();
}

async function prepare(conversationId: string, resultId: string, sourceId: string) {
  const { row, delivery } = resolve(conversationId, resultId);
  const documentId = hash(`${resultId}:${sourceId}:parser:${PARSER_VERSION}`);
  const db = getSqliteDatabase();
  let file: string | undefined;
  let expectedSha256: string | undefined;
  let text: string | undefined;
  let title = delivery.taskTitle;
  let mimeType: string | undefined;
  if (sourceId === 'body') {
    const packet = row.reply_payload_json ? JSON.parse(row.reply_payload_json) as { report?: string; preservedText?: string } : undefined;
    text = delivery.text ?? (packet ? [packet.report, packet.preservedText].filter(Boolean).join('\n\n') : undefined);
    if (!text) return { status: 'unavailable', reason: 'No complete result body was retained. Read an artifact; the summary is not the full result.' };
  } else {
    const artifact = delivery.outcome.deliverables.find(item => item.artifactId === sourceId);
    if (!artifact || artifact.availability !== 'available' || !artifact.uri?.startsWith('media://')) return { status: 'unavailable', reason: 'No readable published artifact for this source ID' };
    ({ path: file } = await resolveMediaReference(artifact.uri));
    expectedSha256 = artifact.sha256;
    title = artifact.title;
    mimeType = artifact.mimeType;
  }
  const existing = documentRow(documentId);
  if (file) {
    const info = await lstat(file).catch(() => undefined);
    if (!info?.isFile()) return { status: 'unavailable', reason: 'Published file is missing or is not a regular file' };
    const fingerprint = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    if (existing?.status === 'ready' && fingerprint !== existing.fingerprint) return { status: 'changed', reason: 'Published bytes changed; the indexed version is not current' };
  }
  // Permissions may change while resolving the file.
  resolve(conversationId, resultId);
  if (existing && existing.status !== 'pending') return { ...existing, documentId };
  let ownerAlive = true;
  const owner = db.prepare('SELECT lease_token FROM personal_result_documents WHERE document_id = ?').get(documentId)?.lease_token;
  if (typeof owner === 'string' && /^\d+:/.test(owner)) {
    try { process.kill(Number(owner.split(':')[0]), 0); } catch { ownerAlive = false; }
  }
  if (existing && existing.lease_until > Date.now() && ownerAlive) return { status: 'preparing', preparationId: documentId };
  if (existing && !ownerAlive) db.prepare('UPDATE personal_result_documents SET lease_until = 0 WHERE document_id = ? AND lease_token = ?').run(documentId, owner);
  if (workers.size >= 2) return { status: 'preparing', preparationId: documentId, reason: 'Preparation capacity is busy; retry this same read later' };
  const lease = `${process.pid}:${randomUUID()}`;
  const claimed = db.prepare(`INSERT INTO personal_result_documents(document_id, delivery_id, source_id, status, parser_version, lease_token, lease_until)
    VALUES (?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT(document_id) DO UPDATE SET lease_token = excluded.lease_token,
    lease_until = excluded.lease_until WHERE personal_result_documents.status = 'pending' AND personal_result_documents.lease_until <= ?`)
    .run(documentId, resultId, sourceId, PARSER_VERSION, lease, Date.now() + 50_000, Date.now());
  if (claimed.changes) launch({ database: databasePath(), documentId, lease, file, expectedSha256, title, mimeType, text });
  return { status: 'preparing', preparationId: documentId };
}

/** Warm only bounded source counts after delivery; never wait for a parser or hold a main conversation lock. */
export function warmPersonalResult(conversationId: string, resultId: string): void {
  const generation = preparationGeneration;
  setImmediate(() => {
    if (generation !== preparationGeneration) return;
    try {
      const { delivery } = resolve(conversationId, resultId);
      const sources = ['body', ...delivery.outcome.deliverables.slice(0, 50).map(item => item.artifactId)];
      void (async () => {
        for (const sourceId of sources) {
          if (generation !== preparationGeneration) return;
          await prepare(conversationId, resultId, sourceId);
          // Wait outside the foreground path; the first two parsers may still be working.
          while (workers.size >= 2 && generation === preparationGeneration) await new Promise(resolve => { const timer = setTimeout(resolve, 100); timer.unref(); });
        }
      })().catch(() => {});
    } catch { /* A removed/unauthorized target is not warmed. */ }
  });
}

export async function readPersonalResult(conversationId: string, raw: PersonalResultInput): Promise<Record<string, unknown>> {
  if (raw.command === 'list') return listPersonalResults(conversationId, raw);
  const input = { ...raw };
  if (!input.resultId) throw new Error('resultId is required; use list to discover results');
  const { delivery, row } = resolve(conversationId, input.resultId);
  const sourceId = input.sourceId ?? 'body';
  const scope = hash(JSON.stringify([input.resultId, sourceId, input.command, input.query, input.sectionId]));
  if (input.cursor) {
    if (input.cursor.length > 1024) throw new Error('Invalid result cursor');
    const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as { scope: string };
    if (cursor.scope !== scope) throw new Error('Cursor belongs to a different result, query or revision');
  }
  const current = getSqliteDatabase().prepare('SELECT latest_contract_version FROM tasks WHERE task_id = ?').get(delivery.taskId) as { latest_contract_version: number };
  const base = { ...(delivery.contractVersion === undefined ? {} : { currentRequirementsSatisfied: delivery.contractVersion === current.latest_contract_version && delivery.outcome.status === 'succeeded'
      && delivery.instructionSequence === Number(getSqliteDatabase().prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM task_collaboration_entries WHERE task_id = ? AND author_kind IN ('main_agent','user') AND kind IN ('instruction','answer')").get(delivery.taskId)?.n ?? 0) }), deliveryState: row.status, resultId: input.resultId, taskId: delivery.taskId, runId: delivery.taskRunId, sourceId };
  if (input.command === 'get' && !input.sourceId) {
    const offset = input.offset ?? 0;
    const limit = Math.min(10, input.limit ?? 10);
    return { ...base, status: delivery.outcome.status, baselineVersion: `${delivery.taskRunId}:${delivery.assignmentEpoch}:${delivery.outcome.outcomeId}`,
    resultRevision: delivery.resultRevision ?? 1, previousResultId: delivery.previousResultId, contractVersion: delivery.contractVersion,
    instructionSequence: delivery.instructionSequence, adoption: delivery.adoption?.slice(offset, offset + limit),
    ...(delivery.adoption && offset + limit < delivery.adoption.length ? { nextAdoptionOffset: offset + limit } : {}),
    body: { sourceId: 'body', description: 'Retained execution result, not the composed chat reply' },
    sources: delivery.outcome.deliverables.slice(offset, offset + limit).map(item => ({ sourceId: item.artifactId, title: item.title.slice(0, 200), kind: item.kind,
      availability: item.availability, mimeType: item.mimeType })),
    ...(offset + limit < delivery.outcome.deliverables.length ? { nextOffset: offset + limit } : {}),
    guidance: 'Use read/search with sourceId=body or an exact artifact sourceId. Omitted chat text is available here when retained.' };
  }
  const prepared = await prepare(conversationId, input.resultId, sourceId);
  if (prepared.status !== 'ready') return { ...base, ...prepared, complete: false };
  const doc = prepared as DocumentRow & { documentId: string };
  if (input.revision && input.revision !== doc.content_revision) throw new Error('Result content revision changed');
  let offset = Math.max(0, input.offset ?? 0);
  const binding = hash(JSON.stringify([input.resultId, sourceId, doc.content_revision, input.command, input.query, input.sectionId]));
  if (input.cursor) {
    if (input.cursor.length > 1024) throw new Error('Invalid result cursor');
    const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as { binding: string; offset: number };
    if (cursor.binding !== binding || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new Error('Cursor belongs to a different result, query or revision');
    offset = cursor.offset;
  }
  const cursorAt = (next: number) => Buffer.from(JSON.stringify({ binding, scope, offset: next })).toString('base64url');
  const metadata = { ...base, revision: doc.content_revision, status: 'ready', representation: 'extracted_text',
    limitations: JSON.parse(doc.limitations_json) as string[], totalChars: doc.length };
  const sectionFromRow = (row: Record<string, unknown>): ResultSection => ({ id: String(row.section_id), title: String(row.title),
    offset: Number(row.start_offset), length: Number(row.char_length), locator: JSON.parse(String(row.locator_json)) });
  const db = getSqliteDatabase();
  if (input.command === 'get') {
    const limit = Math.min(10, input.limit ?? 10);
    const rows = db.prepare('SELECT * FROM personal_result_sections WHERE document_id = ? ORDER BY ordinal LIMIT ? OFFSET ?')
      .all(doc.documentId, limit + 1, offset);
    return { ...metadata, sections: rows.slice(0, limit).map(sectionFromRow),
      ...(rows.length > limit ? { nextCursor: cursorAt(offset + limit) } : {}), complete: rows.length <= limit };
  }
  if (input.command === 'search') {
    const query = input.query?.trim();
    if (!query || [...query].length < 3 || query.length > 500) throw new Error('Search requires 3–500 characters; use read for shorter terms');
    const limit = Math.min(5, Math.max(1, input.limit ?? 5));
    const rows = db.prepare(`SELECT CAST(start_offset AS INTEGER) AS offset, text
      FROM personal_result_search WHERE personal_result_search MATCH ? AND document_id = ?
      ORDER BY CAST(start_offset AS INTEGER) LIMIT ? OFFSET ?`)
      .all(`"${query.replaceAll('"', '""')}"`, doc.documentId, limit + 1, offset) as Array<{ offset: number; text: string }>;
    const items = rows.slice(0, limit).map(row => {
      const start = Math.max(0, row.text.toLowerCase().indexOf(query.toLowerCase()) - 120);
      const hitOffset = row.offset + [...row.text.slice(0, start)].length;
      return { offset: hitOffset, text: row.text.slice(start, start + 800),
      section: db.prepare(`SELECT section_id FROM personal_result_sections WHERE document_id = ?
        AND start_offset <= ? AND start_offset + char_length > ? ORDER BY ordinal DESC LIMIT 1`)
        .get(doc.documentId, hitOffset, hitOffset)?.section_id };
    });
    return { ...metadata, query, items, complete: rows.length <= limit, ...(rows.length > limit ? { nextCursor: cursorAt(offset + items.length) } : {}) };
  }
  const sectionRow = input.sectionId ? db.prepare('SELECT * FROM personal_result_sections WHERE document_id = ? AND section_id = ?')
    .get(doc.documentId, input.sectionId) : undefined;
  const section = sectionRow ? sectionFromRow(sectionRow) : undefined;
  if (input.sectionId && !section) throw new Error('Section is unavailable');
  const start = section?.offset ?? 0;
  const length = section?.length ?? doc.length;
  if (offset > length) throw new Error('Offset exceeds source range');
  const count = Math.min(4000, Math.max(1, input.limit ?? 4000), length - offset);
  const value = db.prepare('SELECT substr(content, ?, ?) AS text FROM personal_result_documents WHERE document_id = ?')
    .get(start + offset + 1, count, doc.documentId) as { text: string };
  const next = offset + [...value.text].length;
  return { ...metadata, section, offset, text: value.text, rangeComplete: next >= length,
    complete: !section && next >= length, ...(next < length ? { nextCursor: cursorAt(next) } : {}) };
}
