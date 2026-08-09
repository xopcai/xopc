import { randomUUID } from 'node:crypto';

import type { DatabaseSync } from 'node:sqlite';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { getFocus } from './repository.js';
import type { FocusCandidate, FocusCandidateStatus, FocusEvidence } from './types.js';
import type { Focus } from './types.js';

interface CandidateRow {
  candidate_id: string;
  canonical_key: string;
  title: string;
  summary: string;
  confidence: number;
  evidence_json: string;
  status: FocusCandidateStatus;
  discovered_at: number;
  updated_at: number;
}

function projectIdsForCandidate(db: DatabaseSync, id: string): string[] {
  const rows = db.prepare(
    'SELECT project_id FROM focus_candidate_projects WHERE candidate_id = ? ORDER BY created_at, project_id',
  ).all(id) as unknown as Array<{ project_id: string }>;
  return rows.map((row) => row.project_id);
}

function candidateFromRow(db: DatabaseSync, row: CandidateRow): FocusCandidate {
  let evidence: FocusEvidence[] = [];
  try {
    const parsed = JSON.parse(row.evidence_json) as unknown;
    if (Array.isArray(parsed)) evidence = parsed as FocusEvidence[];
  } catch {
    evidence = [];
  }
  return {
    id: row.candidate_id,
    canonicalKey: row.canonical_key,
    title: row.title,
    summary: row.summary,
    confidence: row.confidence,
    evidence,
    projectIds: projectIdsForCandidate(db, row.candidate_id),
    status: row.status,
    discoveredAt: row.discovered_at,
    updatedAt: row.updated_at,
  };
}

export function getFocusCandidate(id: string): FocusCandidate | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM focus_candidates WHERE candidate_id = ?')
    .get(id) as unknown as CandidateRow | undefined;
  return row ? candidateFromRow(db, row) : null;
}

export function listFocusCandidates(status: FocusCandidateStatus = 'pending', limit = 20): FocusCandidate[] {
  const { db } = requireXopcDatabase();
  const rows = db.prepare(
    'SELECT * FROM focus_candidates WHERE status = ? ORDER BY updated_at DESC LIMIT ?',
  ).all(status, Math.max(1, Math.min(100, limit))) as unknown as CandidateRow[];
  return rows.map((row) => candidateFromRow(db, row));
}

export function upsertFocusCandidate(input: {
  canonicalKey: string;
  title: string;
  summary: string;
  confidence: number;
  evidence?: FocusEvidence[];
  projectIds?: string[];
  nowMs?: number;
}): FocusCandidate {
  const now = input.nowMs ?? Date.now();
  const id = randomUUID();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO focus_candidates (
        candidate_id, canonical_key, title, summary, confidence, evidence_json,
        status, discovered_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(canonical_key) DO UPDATE SET
        title = CASE WHEN focus_candidates.status = 'pending' THEN excluded.title ELSE focus_candidates.title END,
        summary = CASE WHEN focus_candidates.status = 'pending' THEN excluded.summary ELSE focus_candidates.summary END,
        confidence = CASE WHEN focus_candidates.status = 'pending' THEN excluded.confidence ELSE focus_candidates.confidence END,
        evidence_json = CASE WHEN focus_candidates.status = 'pending' THEN excluded.evidence_json ELSE focus_candidates.evidence_json END,
        updated_at = excluded.updated_at`,
    ).run(
      id,
      input.canonicalKey.trim().slice(0, 300),
      input.title.trim().slice(0, 200),
      input.summary.trim().slice(0, 2_000),
      Math.max(0, Math.min(1, input.confidence)),
      JSON.stringify(input.evidence ?? []),
      now,
      now,
    );
    const row = db.prepare('SELECT candidate_id, status FROM focus_candidates WHERE canonical_key = ?')
      .get(input.canonicalKey.trim().slice(0, 300)) as unknown as { candidate_id: string; status: FocusCandidateStatus };
    if (row.status === 'pending') {
      db.prepare('DELETE FROM focus_candidate_projects WHERE candidate_id = ?').run(row.candidate_id);
      const insertProject = db.prepare(
        'INSERT INTO focus_candidate_projects (candidate_id, project_id, created_at) VALUES (?, ?, ?)',
      );
      for (const projectId of [...new Set(input.projectIds ?? [])].slice(0, 20)) {
        insertProject.run(row.candidate_id, projectId, now);
      }
    }
  });
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM focus_candidates WHERE canonical_key = ?')
    .get(input.canonicalKey.trim().slice(0, 300)) as unknown as CandidateRow;
  return candidateFromRow(db, row);
}

export function setFocusCandidateStatus(id: string, status: FocusCandidateStatus, nowMs = Date.now()): FocusCandidate | null {
  let changed = false;
  runSqliteWriteTransaction((db) => {
    changed = db.prepare('UPDATE focus_candidates SET status = ?, updated_at = ? WHERE candidate_id = ?')
      .run(status, nowMs, id).changes > 0;
  });
  return changed ? getFocusCandidate(id) : null;
}

export function acceptFocusCandidate(id: string, nowMs = Date.now()): Focus | null {
  const candidate = getFocusCandidate(id);
  if (!candidate) return null;
  const existing = requireXopcDatabase().db.prepare(
    'SELECT focus_id FROM focuses WHERE source_candidate_id = ?',
  ).get(id) as unknown as { focus_id: string } | undefined;
  if (existing) return getFocus(existing.focus_id);
  const focusId = randomUUID();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO focuses (
        focus_id, title, summary, status, source, source_candidate_id,
        created_at, updated_at, last_activity_at
      ) VALUES (?, ?, ?, 'active', 'discovery', ?, ?, ?, ?)`,
    ).run(focusId, candidate.title, candidate.summary, candidate.id, nowMs, nowMs, nowMs);
    const insertProject = db.prepare(
      'INSERT INTO focus_projects (focus_id, project_id, created_at) VALUES (?, ?, ?)',
    );
    for (const projectId of candidate.projectIds) insertProject.run(focusId, projectId, nowMs);
    db.prepare(
      `INSERT INTO focus_activities (
        activity_id, focus_id, type, summary, details_json, created_at
      ) VALUES (?, ?, 'created', 'Focus created from discovery', '{}', ?)`,
    ).run(randomUUID(), focusId, nowMs);
    db.prepare("UPDATE focus_candidates SET status = 'accepted', updated_at = ? WHERE candidate_id = ?")
      .run(nowMs, candidate.id);
  });
  return getFocus(focusId);
}
