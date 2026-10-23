import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { redactSensitive } from '../coder/packages/protocol/src/index.js';
import { compareEvidence, hash, readEvidence } from './evidence.js';
import { registry } from './registry.js';
import { record, type Evidence, type EvidenceSource, type Row } from './types.js';

export class ControlStore {
  readonly db: DatabaseSync;
  constructor(readonly path: string) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS evidence (seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, logical_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS evidence_logical ON evidence(logical_id,seq);
      CREATE TABLE IF NOT EXISTS sources (path TEXT PRIMARY KEY, descriptor TEXT NOT NULL, error TEXT, checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS improvements (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
  }
  close(): void { this.db.close(); }
  event(type: string, data: unknown): void {
    this.db.prepare('INSERT INTO events(at,type,data) VALUES(?,?,?)').run(new Date().toISOString(), type, JSON.stringify(redactSensitive(data)));
  }
  import(source: EvidenceSource): { imported: number; error: string | null } {
    let imported = 0;
    let error: string | null = null;
    try {
      const bundles = readEvidence(source);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const bundle of bundles) {
          const result = this.db.prepare('INSERT OR IGNORE INTO evidence(id,logical_id,data) VALUES(?,?,?)').run(bundle.id, bundle.logicalId, JSON.stringify(bundle));
          imported += Number(result.changes);
        }
        this.db.exec('COMMIT');
      } catch (e) { this.db.exec('ROLLBACK'); throw e; }
      if (imported) this.event('evidence.imported', { source: resolve(source.path), imported });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    this.db.prepare('INSERT INTO sources VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET descriptor=excluded.descriptor,error=excluded.error,checked_at=excluded.checked_at')
      .run(resolve(source.path), JSON.stringify(source), error, new Date().toISOString());
    return { imported, error };
  }
  refresh(): void {
    for (const row of this.db.prepare('SELECT descriptor FROM sources').all()) this.import(JSON.parse(String(row.descriptor)) as EvidenceSource);
  }
  list(params: { q?: string; benchmark?: string; evidenceClass?: string; validity?: string; offset?: number; limit?: number } = {}) {
    const rows = this.db.prepare('SELECT data FROM evidence WHERE seq IN (SELECT MAX(seq) FROM evidence GROUP BY logical_id) ORDER BY seq DESC').all();
    const all = rows.map(r => JSON.parse(String(r.data)) as Evidence).filter(e =>
      (!params.benchmark || e.benchmark === params.benchmark) && (!params.evidenceClass || e.evidenceClass === params.evidenceClass)
      && (!params.validity || e.validity === params.validity) && (!params.q || `${e.benchmark} ${e.identity.model} ${e.source}`.toLowerCase().includes(params.q.toLowerCase())));
    const offset = Math.max(0, params.offset ?? 0);
    const items = all.slice(offset, offset + Math.max(1, Math.min(100, params.limit ?? 30)));
    return { total: all.length, items };
  }
  get(id: string): Evidence | null {
    const row = this.db.prepare('SELECT data FROM evidence WHERE id=?').get(id);
    return row ? JSON.parse(String(row.data)) as Evidence : null;
  }
  overview() {
    const evidence = this.list({ limit: 100 }).items;
    const all = this.db.prepare('SELECT data FROM evidence WHERE seq IN (SELECT MAX(seq) FROM evidence GROUP BY logical_id) ORDER BY seq DESC').all().map(r => JSON.parse(String(r.data)) as Evidence)
      .sort((a, b) => (Date.parse(b.createdAt ?? b.importedAt) || 0) - (Date.parse(a.createdAt ?? a.importedAt) || 0));
    return { generatedAt: new Date().toISOString(), evidenceCount: all.length,
      sources: this.db.prepare('SELECT path,error,checked_at FROM sources ORDER BY path').all(),
      benchmarks: registry.map(entry => {
        const matches = all.filter(e => e.benchmark === entry.id);
        return { ...entry, latestAttempt: matches[0] ?? null,
          latestCompleteValid: matches.find(e => e.complete && e.validity === 'valid') ?? null,
          latestLiveCompleteValid: matches.find(e => e.complete && e.validity === 'valid' && ['live_controlled', 'live_product'].includes(e.evidenceClass)) ?? null,
          latestPromoted: matches.find(e => e.promotion === 'promoted') ?? null,
          evidenceCount: matches.length };
      }), recent: evidence.slice(0, 6) };
  }
  events(after = 0, limit = 100) {
    return this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?').all(after, Math.min(500, limit))
      .map(row => ({ seq: Number(row.seq), at: row.at, type: row.type, data: JSON.parse(String(row.data)) as unknown }));
  }
  recentEvents() {
    return this.db.prepare('SELECT seq,at,type FROM events ORDER BY seq DESC LIMIT 20').all();
  }
  campaign(id: string, data: Row): void {
    this.db.prepare('INSERT INTO campaigns VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(redactSensitive({ ...data, id })));
    this.event('campaign.updated', { id, ...data });
  }
  campaigns(): Row[] { return this.db.prepare('SELECT data FROM campaigns ORDER BY rowid DESC LIMIT 100').all().map(r => JSON.parse(String(r.data)) as Row); }
  improvement(data: Row): string {
    if (!data.problem || !data.hypothesis || !data.budget || !data.protection) throw new Error('Improvement requires problem, hypothesis, budget and protection');
    const id = randomUUID();
    this.db.prepare('INSERT INTO improvements VALUES(?,?)').run(id, JSON.stringify(redactSensitive({ ...data, id, createdAt: new Date().toISOString(), promotion: 'not_evaluated' })));
    this.event('improvement.created', { id });
    return id;
  }
  decideImprovement(id: string, assessment: Row): void {
    const row = this.db.prepare('SELECT data FROM improvements WHERE id=?').get(id);
    if (!row) throw new Error('Unknown improvement');
    const data = record(JSON.parse(String(row.data)));
    if (record(data.decision).preregistrationHash) throw new Error('Decision is immutable; register a new candidate for another attempt');
    if (!['promoted', 'rejected'].includes(String(assessment.promotion)) || !assessment.preregistrationHash || !Array.isArray(assessment.audit)) throw new Error('Incomplete decision evidence');
    this.db.prepare('UPDATE improvements SET data=? WHERE id=?').run(JSON.stringify(redactSensitive({ ...data, promotion: assessment.promotion, decision: assessment })), id);
    this.event('improvement.decided', { id, promotion: assessment.promotion, reasons: assessment.reasons });
  }
  supplementImprovement(id: string, file: string, data: Row): void {
    const row=this.db.prepare('SELECT data FROM improvements WHERE id=?').get(id);
    if(!row)throw new Error('Unknown improvement');
    const original=record(JSON.parse(String(row.data))),decisionHash=hash(JSON.stringify(original.decision));
    const supplements=[...(Array.isArray(original.supplements)?original.supplements:[]),{createdAt:new Date().toISOString(),file,hash:hash(readFileSync(file)),data:redactSensitive(data),decisionHash}];
    this.db.prepare('UPDATE improvements SET data=? WHERE id=?').run(JSON.stringify({...original,supplements}),id);
    this.event('improvement.supplemented',{id,file,decisionHash});
  }
  improvements(): Row[] { return this.db.prepare('SELECT data FROM improvements ORDER BY rowid DESC LIMIT 100').all().map(r => JSON.parse(String(r.data)) as Row); }
  currentReview(id: string): { blocked: boolean; evidenceId: string | null } {
    const selected=this.get(id);if(!selected)return {blocked:false,evidenceId:null};
    const row=this.db.prepare('SELECT data FROM evidence WHERE logical_id=? ORDER BY seq DESC LIMIT 1').get(selected.logicalId);
    const latest=row?JSON.parse(String(row.data)) as Evidence:null;
    return {blocked:latest?.reasons.includes('grading_protocol_review') ?? false,evidenceId:latest?.id ?? null};
  }
  compare(left: string, right: string) {
    const a = this.get(left); const b = this.get(right);
    if (!a || !b) throw new Error('Evidence not found');
    const blocked=this.currentReview(left).blocked || this.currentReview(right).blocked;
    const result=compareEvidence(blocked?{...a,validity:'unknown'}:a,blocked?{...b,validity:'unknown'}:b);
    if(blocked)result.mismatches.push('current_grading_protocol_review_blocks_historical_snapshot');
    return result;
  }
  runDetail(bundleId: string, trialId: string, after = 0) {
    const bundle = this.get(bundleId);
    const trial = bundle?.trials.find(t => t.id === trialId);
    if (!bundle || !trial) throw new Error('Trial not found');
    if (!bundle.source.endsWith('.db') || !trial.sourceRunId) return { trial, source: bundle.source, events: [], scores: [], note: 'Summary-only evidence; original trajectory not indexed.' };
    const db = new DatabaseSync(bundle.source, { readOnly: true });
    try {
      const row = db.prepare('SELECT * FROM eval_runs WHERE id=?').get(trial.sourceRunId);
      const scores = db.prepare('SELECT * FROM eval_scores WHERE run_id=? ORDER BY grader_index').all(trial.sourceRunId);
      if (trial.sourceFingerprint && trial.sourceFingerprint !== hash(JSON.stringify({ row, scores }))) throw new Error('Source run changed; select its latest evidence revision');
      return redactSensitive({ trial, run: row,
        events: db.prepare('SELECT * FROM eval_run_events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 100').all(trial.sourceRunId, after),
        scores,
        annotations: db.prepare('SELECT * FROM eval_annotations WHERE run_id=?').all(trial.sourceRunId) });
    } finally { db.close(); }
  }
}

export function readSources(path: string): EvidenceSource[] {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(value)) throw new Error('Source list must be an array');
  return value.map(item => {
    const r = record(item);
    if (typeof r.path !== 'string' || typeof r.benchmark !== 'string' || !['coder-db', 'delivery', 'style', 'memory'].includes(String(r.kind))
      || !['deterministic', 'harness_calibration', 'live_controlled', 'live_product', 'unknown'].includes(String(r.evidenceClass))) throw new Error('Invalid evidence source');
    return r as unknown as EvidenceSource;
  });
}
