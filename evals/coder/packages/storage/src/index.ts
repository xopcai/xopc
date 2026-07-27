import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  redactSensitive,
  redactText,
  type Artifact,
  type EvalCase,
  type ExperimentSpec,
  type GradeResult,
  type TraceEvent,
} from '@agent-evals/protocol';

type DbRow = Record<string, unknown>;

export interface RunRecordInput {
  id: string;
  experimentId: string;
  evalCase: EvalCase;
  variantId: string;
  adapter: string;
  sourceCommit: string;
  fixtureCommit: string;
}

export interface RunCompletionInput {
  status: string;
  finalText: string;
  sessionKey?: string;
  agentRunId?: string;
  usage?: Record<string, number>;
  runtimeIdentity?: Record<string, unknown>;
  error?: string;
  score: number;
}

export class EvalStore {
  readonly path: string;
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.path = resolve(path);
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS eval_experiments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        suite_id TEXT NOT NULL,
        suite_version TEXT NOT NULL,
        suite_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS eval_runs (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL REFERENCES eval_experiments(id) ON DELETE CASCADE,
        case_id TEXT NOT NULL,
        case_json TEXT NOT NULL,
        variant_id TEXT NOT NULL,
        adapter TEXT NOT NULL,
        source_commit TEXT NOT NULL,
        fixture_commit TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        session_key TEXT,
        agent_run_id TEXT,
        final_text TEXT NOT NULL DEFAULT '',
        usage_json TEXT NOT NULL DEFAULT '{}',
        runtime_identity_json TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        score REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_eval_runs_experiment
        ON eval_runs(experiment_id, case_id, variant_id);
      CREATE TABLE IF NOT EXISTS eval_run_events (
        run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        parent_event_id TEXT,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        artifact_refs_json TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (run_id, seq)
      );
      CREATE TABLE IF NOT EXISTS eval_scores (
        run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
        grader_index INTEGER NOT NULL,
        grader_type TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'correctness',
        required INTEGER NOT NULL DEFAULT 1,
        weight REAL NOT NULL DEFAULT 1,
        passed INTEGER NOT NULL,
        score REAL NOT NULL,
        summary TEXT NOT NULL,
        artifact_refs_json TEXT NOT NULL DEFAULT '[]',
        duration_ms INTEGER NOT NULL,
        PRIMARY KEY (run_id, grader_index)
      );
      CREATE TABLE IF NOT EXISTS eval_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS eval_annotations (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
        failure_category TEXT,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureColumn('eval_runs', 'fixture_commit', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('eval_runs', 'runtime_identity_json', "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn('eval_scores', 'category', "TEXT NOT NULL DEFAULT 'correctness'");
    this.ensureColumn('eval_scores', 'required', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('eval_scores', 'weight', 'REAL NOT NULL DEFAULT 1');
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
    if (columns.some((entry) => entry.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  createExperiment(params: {
    id: string;
    name: string;
    suiteId: string;
    suiteVersion: string;
    suiteHash: string;
    spec: ExperimentSpec;
  }): void {
    this.db.prepare(`
      INSERT INTO eval_experiments
        (id, name, suite_id, suite_version, suite_hash, status, spec_json, created_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?)
    `).run(
      params.id,
      params.name,
      params.suiteId,
      params.suiteVersion,
      params.suiteHash,
      JSON.stringify(redactSensitive(params.spec)),
      new Date().toISOString(),
    );
  }

  completeExperiment(id: string, status: 'completed' | 'failed'): void {
    this.db.prepare(
      'UPDATE eval_experiments SET status = ?, completed_at = ? WHERE id = ?',
    ).run(status, new Date().toISOString(), id);
  }

  createRun(input: RunRecordInput): void {
    this.db.prepare(`
      INSERT INTO eval_runs
        (id, experiment_id, case_id, case_json, variant_id, adapter, source_commit, fixture_commit, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
    `).run(
      input.id,
      input.experimentId,
      input.evalCase.id,
      JSON.stringify(redactSensitive(input.evalCase)),
      input.variantId,
      input.adapter,
      input.sourceCommit,
      input.fixtureCommit,
      new Date().toISOString(),
    );
  }

  appendEvent(event: TraceEvent): void {
    this.db.prepare(`
      INSERT INTO eval_run_events
        (run_id, seq, event_id, parent_event_id, type, timestamp, payload_json, artifact_refs_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.runId,
      event.seq,
      event.eventId,
      event.parentEventId ?? null,
      event.type,
      event.timestamp,
      JSON.stringify(redactSensitive(event.payload)),
      JSON.stringify(event.artifactRefs ?? []),
    );
  }

  recordGrade(runId: string, grade: GradeResult): void {
    this.db.prepare(`
      INSERT INTO eval_scores
        (run_id, grader_index, grader_type, category, required, weight, passed, score, summary, artifact_refs_json, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      grade.graderIndex,
      grade.graderType,
      grade.category,
      grade.required ? 1 : 0,
      grade.weight,
      grade.passed ? 1 : 0,
      grade.score,
      grade.summary,
      JSON.stringify(grade.artifactRefs),
      grade.durationMs,
    );
  }

  recordArtifact(artifact: Artifact): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO eval_artifacts
        (id, run_id, kind, sha256, path, size_bytes, mime_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifact.id,
      artifact.runId,
      artifact.kind,
      artifact.sha256,
      artifact.path,
      artifact.sizeBytes,
      artifact.mimeType,
      artifact.createdAt,
    );
  }

  completeRun(id: string, input: RunCompletionInput): void {
    this.db.prepare(`
      UPDATE eval_runs SET
        status = ?, ended_at = ?, session_key = ?, agent_run_id = ?, final_text = ?,
        usage_json = ?, runtime_identity_json = ?, error = ?, score = ?
      WHERE id = ?
    `).run(
      input.status,
      new Date().toISOString(),
      input.sessionKey ?? null,
      input.agentRunId ?? null,
      redactText(input.finalText),
      JSON.stringify(redactSensitive(input.usage ?? {})),
      JSON.stringify(redactSensitive(input.runtimeIdentity ?? {})),
      input.error ? redactText(input.error) : null,
      input.score,
      id,
    );
  }

  listExperiments(): DbRow[] {
    return this.db.prepare(`
      SELECT e.*,
        COUNT(r.id) AS run_count,
        SUM(CASE WHEN r.status = 'passed' THEN 1 ELSE 0 END) AS passed_count,
        AVG(r.score) AS average_score
      FROM eval_experiments e
      LEFT JOIN eval_runs r ON r.experiment_id = e.id
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `).all() as DbRow[];
  }

  listTrend(params: { suiteId?: string; limit?: number } = {}): DbRow[] {
    const limit = Math.max(1, Math.min(500, params.limit ?? 100));
    return this.db.prepare(`
      WITH normalized_runs AS (
        SELECT
          *,
          CASE
            WHEN instr(variant_id, '#') > 0
              THEN substr(variant_id, 1, instr(variant_id, '#') - 1)
            ELSE variant_id
          END AS base_variant_id
        FROM eval_runs
      )
      SELECT
        e.id AS experiment_id,
        e.name AS experiment_name,
        e.suite_id,
        e.suite_version,
        e.suite_hash,
        e.created_at,
        r.base_variant_id AS variant_id,
        COUNT(r.id) AS run_count,
        SUM(CASE WHEN r.status = 'passed' THEN 1 ELSE 0 END) AS passed_count,
        SUM(CASE WHEN r.status IN ('error', 'timed_out', 'budget_exceeded') THEN 1 ELSE 0 END)
          AS execution_failure_count,
        AVG(r.score) AS average_score,
        AVG(
          CASE WHEN r.ended_at IS NOT NULL
            THEN (julianday(r.ended_at) - julianday(r.started_at)) * 86400000
            ELSE NULL
          END
        ) AS average_duration_ms
      FROM eval_experiments e
      JOIN normalized_runs r ON r.experiment_id = e.id
      WHERE (? IS NULL OR e.suite_id = ?)
      GROUP BY e.id, r.base_variant_id
      ORDER BY e.created_at DESC, r.base_variant_id
      LIMIT ?
    `).all(params.suiteId ?? null, params.suiteId ?? null, limit) as DbRow[];
  }

  getExperiment(id: string): { experiment: DbRow; runs: DbRow[] } | undefined {
    const experiment = this.db.prepare(
      'SELECT * FROM eval_experiments WHERE id = ?',
    ).get(id) as DbRow | undefined;
    if (!experiment) return undefined;
    const runs = this.db.prepare(`
      SELECT r.*,
        COUNT(s.grader_index) AS grader_count,
        SUM(CASE WHEN s.passed = 1 THEN 1 ELSE 0 END) AS graders_passed
      FROM eval_runs r
      LEFT JOIN eval_scores s ON s.run_id = r.id
      WHERE r.experiment_id = ?
      GROUP BY r.id
      ORDER BY r.case_id, r.variant_id, r.started_at
    `).all(id) as DbRow[];
    return { experiment, runs };
  }

  getRun(id: string): {
    run: DbRow;
    events: DbRow[];
    scores: DbRow[];
    artifacts: DbRow[];
    annotations: DbRow[];
  } | undefined {
    const run = this.db.prepare('SELECT * FROM eval_runs WHERE id = ?').get(id) as DbRow | undefined;
    if (!run) return undefined;
    return {
      run,
      events: this.db.prepare(
        'SELECT * FROM eval_run_events WHERE run_id = ? ORDER BY seq',
      ).all(id) as DbRow[],
      scores: this.db.prepare(
        'SELECT * FROM eval_scores WHERE run_id = ? ORDER BY grader_index',
      ).all(id) as DbRow[],
      artifacts: this.db.prepare(
        'SELECT * FROM eval_artifacts WHERE run_id = ? ORDER BY created_at',
      ).all(id) as DbRow[],
      annotations: this.db.prepare(
        'SELECT * FROM eval_annotations WHERE run_id = ? ORDER BY created_at',
      ).all(id) as DbRow[],
    };
  }

  annotateRun(runId: string, params: { failureCategory?: string; note: string }): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO eval_annotations (id, run_id, failure_category, note, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      runId,
      params.failureCategory ?? null,
      redactText(params.note),
      new Date().toISOString(),
    );
    return id;
  }

  close(): void {
    this.db.close();
  }
}

export class ArtifactStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  putText(runId: string, kind: string, content: string, mimeType = 'text/plain'): Artifact {
    const bytes = Buffer.from(content);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const extension = mimeType === 'application/json' ? '.json' : '.txt';
    const path = join(this.root, sha256.slice(0, 2), `${sha256}${extension}`);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, bytes, { flag: 'wx' });
    return this.buildArtifact(runId, kind, sha256, path, bytes.byteLength, mimeType);
  }

  putFile(runId: string, kind: string, sourcePath: string, mimeType = 'application/octet-stream'): Artifact {
    const bytes = readFileSync(sourcePath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const path = join(this.root, sha256.slice(0, 2), `${sha256}${extname(sourcePath)}`);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) copyFileSync(sourcePath, path);
    return this.buildArtifact(runId, kind, sha256, path, bytes.byteLength, mimeType);
  }

  private buildArtifact(
    runId: string,
    kind: string,
    sha256: string,
    path: string,
    sizeBytes: number,
    mimeType: string,
  ): Artifact {
    return {
      id: randomUUID(),
      runId,
      kind,
      sha256,
      path,
      sizeBytes,
      mimeType,
      createdAt: new Date().toISOString(),
    };
  }
}
