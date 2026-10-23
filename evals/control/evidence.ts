import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { array, count, record, string, type Evidence, type EvidenceSource, type Row, type Trial } from './types.js';

export const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const parsed = (value: unknown): Row => typeof value === 'string' ? record(JSON.parse(value)) : record(value);
const assessment = (value: unknown): string => ['passed', 'failed', 'manual_review', 'pending', 'unavailable'].includes(String(value)) ? String(value) : 'unavailable';

function trial(value: unknown, index: number): Trial {
  const r = record(value);
  const judgment = record(r.judgment);
  const id = string(r.case_id ?? r.caseId ?? r.id ?? r.scenario) ?? `unidentified-${index}`;
  const variant = string(r.variant_id ?? r.variantId ?? r.arm ?? r.variant) ?? 'unknown';
  const status = string(r.runnerStatus ?? r.status) ?? (typeof r.error === 'string' ? 'error' : r.success === true || typeof judgment.correct === 'boolean' ? 'passed' : r.success === false ? 'failed' : 'unknown');
  const grade = r.confirmedStatus ?? r.assessment ?? r.status ?? (r.correct === true || judgment.correct === true || r.success === true ? 'passed' : r.correct === false || judgment.correct === false || r.success === false ? 'failed' : 'unavailable');
  const repetition = count(r.repetition ?? r.round) ?? Number(variant.match(/#(\d+)$/)?.[1] ?? 1);
  return { id: hash(`${id}/${variant}/${repetition}/${index}`).slice(0, 20), caseId: id,
    variant: variant.replace(/#\d+$/, ''), repetition, execution: ['passed', 'failed', 'manual_review'].includes(status) ? 'completed' : status,
    assessment: assessment(grade), durationMs: count(r.durationMs ?? r.totalMs),
    tokens: count(record(r.usage).total ?? record(r.usage).totalTokens ?? r.observedResponseTokens), sourceRunId: string(r.runId ?? r.id), sourceFingerprint: string(r.evidenceFingerprint) };
}

/** Read source databases without opening EvalStore (which would migrate them). */
export function readEvidence(source: EvidenceSource): Evidence[] {
  const path = resolve(source.path);
  const review = source.review ? parsed(readFileSync(resolve(source.review), 'utf8')) : null;
  const externalManifest = source.manifest ? parsed(readFileSync(resolve(source.manifest), 'utf8')) : {};
  let documents: Array<{ data: Row; rawHash: string; key: string }>;
  if (source.kind === 'coder-db') {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec('BEGIN');
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => String(r.name)));
      const experiments = db.prepare('SELECT * FROM eval_experiments ORDER BY created_at').all();
      documents = experiments.map(e => {
        const runs = db.prepare('SELECT * FROM eval_runs WHERE experiment_id = ? ORDER BY case_id, variant_id, started_at').all(String(e.id)).map(row => {
          const scores = tables.has('eval_scores') ? db.prepare('SELECT * FROM eval_scores WHERE run_id=? ORDER BY grader_index').all(String(row.id)) : [];
          return { ...row, evidenceFingerprint: hash(JSON.stringify({ row, scores })) };
        });
        const data = { experiment: e, runs };
        return { data, rawHash: hash(JSON.stringify(data)), key: String(e.id) };
      });
      db.exec('COMMIT');
    } finally { db.close(); }
  } else {
    const raw = readFileSync(path);
    documents = [{ data: parsed(raw.toString('utf8')), rawHash: hash(raw), key: 'summary' }];
  }
  return documents.map(({ data, rawHash, key }) => {
    const manifest = { ...record(data.manifest), ...externalManifest };
    const experiment = record(data.experiment);
    const spec = parsed(experiment.spec_json ?? manifest.spec);
    const dialectRows = data.runs ?? data.trials ?? data.cases ?? data.results;
    const rows = array(dialectRows);
    const trials = rows.map(trial);
    const explicitExpected = count(source.expected ?? data.expected ?? data.scheduled ?? data.requestedRuns ?? manifest.expected);
    const requested = count(data.requestedRounds);
    const scenarioCount = array(data.requestedScenarios).length;
    const expected = explicitExpected ?? (requested !== null && scenarioCount ? requested * scenarioCount : count(data.total));
    const completeFlag = data.complete ?? record(data.completion).complete;
    const terminalDb = ['completed', 'failed'].includes(String(experiment.status));
    const completed = trials.filter(t => !['queued', 'running', 'pending', 'unknown'].includes(t.execution)).length;
    const summaryCompleted = count(data.scored ?? data.completed);
    const complete = completeFlag === false || (source.kind === 'coder-db' && !terminalDb) ? false : expected !== null
      ? (trials.length ? completed === expected : summaryCompleted === expected)
      : false;
    const drift = data.sourceChanged ?? data.sourceDrift ?? manifest.sourceChangedDuringRun ?? manifest.sourceDrift ?? record(data.completion).sourceChanged;
    const reasons: string[] = [];
    if (review?.blocking === true) reasons.push('grading_protocol_review');
    if (!complete) reasons.push('incomplete_or_unknown_denominator');
    if (drift === true) reasons.push('source_drift');
    if (data.valid === false || data.validity === 'invalid') reasons.push('declared_invalid');
    if (trials.some(t => ['error', 'unknown'].includes(t.execution))) reasons.push('execution_or_protocol_error');
    if (!trials.length) reasons.push('summary_only');
    const fingerprints = record(manifest.sourceHashes ?? manifest.hashes ?? record(manifest.sourceOrigin).sourceHash);
    const missingFiles = Object.values(fingerprints).some(value => value === null || value === 'missing');
    if (missingFiles) reasons.push('source_files_missing');
    const sourceIdentity = string(manifest.sourceHash ?? record(manifest.sourceOrigin).sourceHash) ?? (Object.keys(fingerprints).length ? hash(JSON.stringify(fingerprints)) : null);
    const suiteHash = string(data.suiteHash ?? manifest.suiteHash ?? experiment.suite_hash);
    const model = string(manifest.model ?? data.model ?? record(array(spec.variants)[0]).model);
    const invalid = reasons.includes('source_drift') || reasons.includes('declared_invalid');
    const validity = invalid ? 'invalid' : complete && sourceIdentity && !missingFiles && drift === false && review?.blocking !== true ? 'valid' : 'unknown';
    if (!sourceIdentity) reasons.push('source_fingerprint_unknown');
    const logicalId = hash(`${path}\0${key}`);
    return {
      schemaVersion: 1,
      normalizationVersion: 2,
      id: hash(`projection-v2\0${logicalId}\0${rawHash}\0${JSON.stringify(manifest)}\0${JSON.stringify(source)}${review ? '\0' + JSON.stringify(review) : ''}`), logicalId,
      benchmark: string(experiment.suite_id) ?? source.benchmark, evidenceClass: source.evidenceClass,
      source: path, sourceHash: rawHash, importedAt: new Date().toISOString(),
      createdAt: string(data.createdAt ?? manifest.startedAt ?? manifest.createdAt ?? experiment.created_at),
      expected, complete, validity, reasons, promotion: 'not_evaluated',
      identity: { suiteHash, sourceHash: sourceIdentity, model,
        selection: string(manifest.selectionHash),
        reasoning: string(manifest.reasoning ?? data.thinkingLevel ?? record(array(spec.variants)[0]).reasoning),
        fixture: string(manifest.fixtureCommit), grader: string(manifest.graderHash),
        lockfile: string(manifest.lockfileHash ?? fingerprints['pnpm-lock.yaml']), environment: string(manifest.environmentHash),
        budget: Object.keys(record(manifest.budget)).length ? hash(JSON.stringify(manifest.budget)) : null },
      trials, metrics: { ...(review ? {protocolReview:review} : {}), ...record(data.metrics ?? data.observations ?? data.traits ?? data.categories),
        summary: Object.fromEntries(['expected', 'scored', 'errors', 'passed', 'failed', 'HSR', 'SSR', 'CSL', 'qualityPassRate', 'officialLeaderboardScore'].filter(k => k in data).map(k => [k, data[k]])) },
      lineage: string(data.sourceExperimentId ?? data.prior ?? data.originalRun),
    } satisfies Evidence;
  });
}

export function compareEvidence(left: Evidence, right: Evidence) {
  const mismatches = ['benchmark', 'evidenceClass'].filter(key => left[key as 'benchmark'] !== right[key as 'benchmark']);
  for (const key of ['suiteHash', 'selection', 'model', 'reasoning', 'fixture', 'grader', 'lockfile', 'environment', 'budget']) {
    if (!left.identity[key] || !right.identity[key]) mismatches.push(`${key}:unknown`);
    else if (left.identity[key] !== right.identity[key]) mismatches.push(`${key}:different`);
  }
  if (!left.complete || !right.complete) mismatches.push('incomplete');
  if (left.validity !== 'valid' || right.validity !== 'valid') mismatches.push('validity_unconfirmed');
  const map = (e: Evidence) => new Map(e.trials.map(t => [`${t.caseId}/${t.variant}/${t.repetition}`, t]));
  const a = map(left); const b = map(right);
  const pairs = [...new Set([...a.keys(), ...b.keys()])].map(key => ({ key, baseline: a.get(key) ?? null, candidate: b.get(key) ?? null }));
  const summary = { wins: 0, losses: 0, ties: 0, unresolved: 0, missing: 0 };
  for (const pair of pairs) {
    if (!pair.baseline || !pair.candidate) { summary.missing++; continue; }
    const before = pair.baseline.assessment; const after = pair.candidate.assessment;
    if (![before, after].every(s => ['passed', 'failed'].includes(s))) summary.unresolved++;
    else if (before === after) summary.ties++;
    else if (after === 'passed') summary.wins++;
    else summary.losses++;
  }
  if (pairs.some(p => !p.baseline || !p.candidate)) mismatches.push('missing_pairs');
  return { comparable: mismatches.length === 0, mismatches, pairs, summary,
    sources: { baseline: left.identity.sourceHash, candidate: right.identity.sourceHash },
    decision: mismatches.length ? 'insufficient_evidence' : right.evidenceClass === 'harness_calibration' ? 'calibration_only'
      : right.trials.some(t => t.assessment !== 'passed') ? 'rejected' : 'requires_predeclared_gate' };
}
