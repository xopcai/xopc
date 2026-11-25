import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveSkillsDir, resolveStateDir } from '../config/paths.js';
import { resolveWorkspaceSkillsDir } from '../agent/skills/workspace-skills-dir.js';
import { writeTextAtomicSync } from '../infra/write-file-atomic.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export type RsiSkillVersion = { candidateId: string; targetId: string; version: number };

type InstalledSkill = {
  id: string;
  target_id: string;
  scope_type: 'global' | 'workspace' | 'project' | 'agent';
  scope_id: string | null;
  adopted_version: number;
};

export function rsiSkillContentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function rsiProjectSkillRoot(projectId: string): string {
  return join(resolveStateDir(), 'rsi-project-skills', rsiSkillContentHash(projectId));
}

export function rsiProjectSkillFile(projectId: string, candidateId: string, name: string): string {
  return join(rsiProjectSkillRoot(projectId), rsiSkillContentHash(candidateId), name, 'SKILL.md');
}

export function currentRsiProjectSkillMarkdown(projectId: string, name: string): string | undefined {
  const row = getSqliteDatabase().prepare(`
    SELECT staged_payload_json FROM rsi_capability_candidates
    WHERE scope_type = 'project' AND scope_id = ? AND artifact_kind = 'skill'
      AND target_id = ? AND status = 'adopted'
    ORDER BY adopted_version DESC LIMIT 1
  `).get(projectId, name) as { staged_payload_json: string } | undefined;
  return row ? (JSON.parse(row.staged_payload_json) as { skillMarkdown: string }).skillMarkdown : undefined;
}

export function loadRsiProjectSkillFiles(projectId: string): string[] {
  if (!isXopcDatabaseOpen()) return [];
  const db = getSqliteDatabase();
  if (!db.prepare('SELECT 1 FROM projects WHERE project_id = ?').get(projectId)) return [];
  const rows = db.prepare(`
    SELECT id, target_id, staged_payload_json, content_hash FROM rsi_capability_candidates
    WHERE artifact_kind = 'skill' AND scope_type = 'project' AND scope_id = ? AND status = 'adopted'
    ORDER BY adopted_version DESC
  `).all(projectId) as Array<{ id: string; target_id: string; staged_payload_json: string; content_hash: string }>;
  const paths = new Map<string, string>();
  for (const row of rows) {
    if (paths.has(row.target_id)) continue;
    const path = rsiProjectSkillFile(projectId, row.id, row.target_id);
    const markdown = JSON.parse(row.staged_payload_json).skillMarkdown as string;
    if (rsiSkillContentHash(markdown) !== row.content_hash) continue;
    // Installed databases can already have approved project skills from before
    // project files had their own directory. Recover those from the approved payload.
    if (!existsSync(path) || readFileSync(path, 'utf8') !== markdown) writeTextAtomicSync(path, markdown);
    paths.set(row.target_id, path);
  }
  return [...paths.values()];
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function installations(name: string, hash: string): InstalledSkill[] {
  if (!isXopcDatabaseOpen()) return [];
  return getSqliteDatabase().prepare(`
    SELECT id, target_id, scope_type, scope_id, adopted_version
    FROM rsi_capability_candidates
    WHERE artifact_kind = 'skill' AND target_id = ? AND content_hash = ? AND adopted_version IS NOT NULL
    ORDER BY CASE WHEN status = 'adopted' THEN 0 ELSE 1 END, adopted_version DESC
  `).all(name, hash) as InstalledSkill[];
}

function installedPath(row: InstalledSkill): string | undefined {
  if (row.scope_type === 'project') {
    return row.scope_id ? rsiProjectSkillFile(row.scope_id, row.id, row.target_id) : undefined;
  }
  if (row.scope_type === 'workspace') {
    return row.scope_id ? join(resolveWorkspaceSkillsDir(row.scope_id), row.target_id, 'SKILL.md') : undefined;
  }
  return join(resolveSkillsDir(), row.target_id, 'SKILL.md');
}

export function resolveRsiSkillVersion(name: string, path: string, hash: string): RsiSkillVersion | undefined {
  const file = canonicalPath(path);
  for (const row of installations(name, hash)) {
    const expected = installedPath(row);
    if (expected && canonicalPath(expected) === file) {
      return { candidateId: row.id, targetId: row.target_id, version: row.adopted_version };
    }
  }
  return undefined;
}

export function isLegacyRsiProjectSkillCopy(name: string, path: string, hash: string): boolean {
  const matches = installations(name, hash);
  if (!matches.some(row => row.scope_type === 'project')) return false;
  const file = canonicalPath(path);
  // Keep independently adopted workspace skills even if their bytes match.
  return !matches.some(row => {
    if (row.scope_type !== 'workspace') return false;
    const expected = installedPath(row);
    return expected !== undefined && canonicalPath(expected) === file;
  });
}
