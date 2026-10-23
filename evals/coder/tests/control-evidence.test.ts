import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { compareEvidence, readEvidence } from '../../control/evidence.js';
import { ControlStore } from '../../control/store.js';
import type { EvidenceSource } from '../../control/types.js';

const dirs: string[] = [];
const root = () => { const p = mkdtempSync(join(tmpdir(), 'xopc-control-evidence-')); dirs.push(p); return p; };
afterEach(() => dirs.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));

describe('unified evidence', () => {
  it('retains failures and unknown identity, imports idempotently, and keeps previous revisions', () => {
    const p = root(); const path = join(p, 'report.json');
    const source: EvidenceSource = { path, kind: 'delivery', benchmark: 'personal-delivery', evidenceClass: 'deterministic', expected: 2 };
    writeFileSync(path, JSON.stringify({ total: 2, cases: [{ id: 'one', status: 'passed' }] }));
    const before = readFileSync(path);
    const store = new ControlStore(join(p, 'index.db'));
    try {
      expect(store.import(source)).toEqual({ imported: 1, error: null });
      expect(store.import(source).imported).toBe(0);
      const first = store.list().items[0]!;
      expect(first.complete).toBe(false); expect(first.expected).toBe(2); expect(first.validity).toBe('unknown');
      expect(readFileSync(path).equals(before)).toBe(true);
      writeFileSync(path, JSON.stringify({ total: 2, cases: [{ id: 'one', status: 'passed' }, { id: 'two', status: 'failed' }] }));
      expect(store.import(source).imported).toBe(1);
      expect(store.list().total).toBe(1);
      const current = store.list().items[0]!;
      expect(current.complete).toBe(true); expect(current.trials[1]!.assessment).toBe('failed');
      expect(store.get(first.id)).not.toBeNull();
      rmSync(path);
      expect(store.import(source).error).not.toBeNull();
      expect(store.get(current.id)).not.toBeNull();
      expect(store.overview().sources[0]!.error).not.toBeNull();
    } finally { store.close(); }
  });

  it('versions a blocking protocol review without rewriting original grades or source bytes',()=>{
    const p=root(),path=join(p,'report.json'),review=join(p,'review.json');
    writeFileSync(path,JSON.stringify({total:1,sourceDrift:false,manifest:{sourceHash:'fixed'},cases:[{id:'c',status:'failed'}]}));
    const source:EvidenceSource={path,kind:'delivery',benchmark:'xopc-core',evidenceClass:'live_controlled',expected:1};
    const before=readFileSync(path),original=readEvidence(source)[0]!;
    expect(original.validity).toBe('valid');
    writeFileSync(review,JSON.stringify({blocking:true,finding:'Contract ambiguity'}));
    const revised=readEvidence({...source,review})[0]!;
    expect(revised.id).not.toBe(original.id);expect(revised.logicalId).toBe(original.logicalId);
    expect(revised.validity).toBe('unknown');expect(revised.reasons).toContain('grading_protocol_review');
    expect(revised.trials[0]!.assessment).toBe('failed');expect(readFileSync(path).equals(before)).toBe(true);
    const store=new ControlStore(join(p,'index.db'));
    try{store.import(source);store.import({...source,review});expect(store.currentReview(original.id).blocked).toBe(true);expect(store.compare(original.id,original.id).mismatches).toContain('current_grading_protocol_review_blocks_historical_snapshot');}
    finally{store.close();}
  });

  it('never treats EQ traits as pass rate or incomplete capture as a completed baseline', () => {
    const p = root(); const path = join(p, 'eq.json');
    writeFileSync(path, JSON.stringify({ expected: 12, scored: 12, complete: true, traits: { naturalness: 6.75 }, qualityPassRate: null }));
    const e = readEvidence({ path, kind: 'style', benchmark: 'personal-style', evidenceClass: 'live_product' })[0]!;
    expect(e.complete).toBe(true); expect(e.trials).toEqual([]); expect(e.metrics.naturalness).toBe(6.75);
    expect(e.metrics.summary).toMatchObject({ qualityPassRate: null }); expect(e.validity).toBe('unknown');
    expect(compareEvidence(e, e)).toMatchObject({ comparable: false, decision: 'insufficient_evidence' });
    writeFileSync(path, JSON.stringify({ expected: 12, scored: 12, complete: false }));
    expect(readEvidence({ path, kind: 'style', benchmark: 'personal-style', evidenceClass: 'live_product' })[0]!.complete).toBe(false);
  });

  it('reads source SQLite with read-only permissions and never migrates source schema', () => {
    const p = root(); const path = join(p, 'source.db');
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE eval_experiments(id TEXT,status TEXT,suite_id TEXT,created_at TEXT,spec_json TEXT);
      CREATE TABLE eval_runs(id TEXT,experiment_id TEXT,case_id TEXT,variant_id TEXT,status TEXT,started_at TEXT);
      INSERT INTO eval_experiments VALUES('e','completed','xopc-core','2026-10-23','{}');
      INSERT INTO eval_runs VALUES('r','e','c','v','passed','2026-10-23');`);
    db.close();
    const before = readFileSync(path);
    const [e] = readEvidence({ path, kind: 'coder-db', benchmark: 'xopc-core', evidenceClass: 'harness_calibration', expected: 1 });
    expect(e!.evidenceClass).toBe('harness_calibration'); expect(e!.trials[0]!.sourceRunId).toBe('r');
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('rejects source drift and retains manual review instead of inferring promotion', () => {
    const p = root(); const path = join(p, 'review.json');
    writeFileSync(path, JSON.stringify({ total: 1, sourceChanged: true, runs: [{ caseId: 'c', runnerStatus: 'passed', confirmedStatus: 'manual_review' }] }));
    const [e] = readEvidence({ path, kind: 'delivery', benchmark: 'xopc-core', evidenceClass: 'live_controlled' });
    expect(e!.validity).toBe('invalid'); expect(e!.promotion).toBe('not_evaluated'); expect(e!.trials[0]!.assessment).toBe('manual_review');
  });

  it('keeps terminal memory service errors in the completed denominator without inventing correct answers', () => {
    const p = root(); const path = join(p, 'memory.json');
    writeFileSync(path, JSON.stringify({ scheduled: 2, completed: 2, results: [
      { id: 'correct', judgment: { correct: true } }, { id: 'service-error', error: '502' },
    ] }));
    const e = readEvidence({ path, kind: 'memory', benchmark: 'personal-memory', evidenceClass: 'live_product' })[0]!;
    expect(e.complete).toBe(true); expect(e.expected).toBe(2);
    expect(e.trials[1]).toMatchObject({ execution: 'error', assessment: 'unavailable' });
  });
});
