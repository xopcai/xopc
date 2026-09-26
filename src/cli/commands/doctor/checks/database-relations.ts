import { existsSync } from 'node:fs';

import { getSqliteDatabase, requireXopcDatabase } from '../../../../storage/sqlite/index.js';
import type { CheckResult, DoctorContext } from '../types.js';

const IMPLICIT_RELATION_CHECKS = [
  ['session active transcript', `SELECT COUNT(*) AS count FROM sessions s
    LEFT JOIN transcripts t ON t.transcript_id = s.active_transcript_id
    WHERE t.transcript_id IS NULL`],
  ['session project', `SELECT COUNT(*) AS count FROM sessions s
    LEFT JOIN projects p ON p.project_id = s.project_id
    WHERE s.project_id IS NOT NULL AND p.project_id IS NULL`],
  ['queued session input', `SELECT COUNT(*) AS count FROM session_inputs i
    LEFT JOIN sessions s ON s.conversation_id = i.conversation_id
    WHERE s.conversation_id IS NULL`],
  ['discussion action task', `SELECT COUNT(*) AS count FROM discussion_action_tasks a
    LEFT JOIN tasks t ON t.task_id = a.task_id
    WHERE t.task_id IS NULL`],
  ['workflow event run', `SELECT COUNT(*) AS count FROM workflow_events e
    LEFT JOIN workflow_runs r ON r.run_id = e.run_id
    WHERE r.run_id IS NULL`],
  ['local app active release', `SELECT COUNT(*) AS count FROM local_apps a
    LEFT JOIN local_app_releases r ON r.release_id = a.active_release_id
    WHERE a.active_release_id IS NOT NULL AND r.release_id IS NULL`],
  ['automation run owner', `SELECT COUNT(*) AS count FROM automation_runs r
    LEFT JOIN automations a ON a.automation_id = r.automation_id
    WHERE a.automation_id IS NULL`],
  ['automation run event', `SELECT COUNT(*) AS count FROM automation_run_events e
    LEFT JOIN automation_runs r ON r.run_id = e.run_id
    WHERE r.run_id IS NULL`],
  ['automation event delivery owner', `SELECT COUNT(*) AS count FROM automation_event_deliveries d
    LEFT JOIN automations a ON a.automation_id = d.automation_id
    WHERE a.automation_id IS NULL`],
] as const;

export async function checkDatabaseRelations(ctx: DoctorContext): Promise<CheckResult> {
  if (!ctx.options.deep) {
    return {
      id: 'database-relations', label: 'Database relations', status: 'skip',
      message: 'Deep mode off; relation scan skipped.', hints: ['Run: xopc doctor --deep'],
    };
  }
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'database-relations', label: 'Database relations', status: 'skip',
      message: 'No config file; skipped.', hints: [],
    };
  }

  requireXopcDatabase();
  const db = getSqliteDatabase();
  const issues: string[] = [];

  const tables = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>)
    .map((row) => row.name));
  for (const table of tables) {
    const escaped = table.replaceAll('"', '""');
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list("${escaped}")`).all() as Array<{ table: string }>;
    for (const foreignKey of foreignKeys) {
      if (!tables.has(foreignKey.table)) issues.push(`missing foreign-key target ${table} -> ${foreignKey.table}`);
    }
  }

  const violations = db.prepare('PRAGMA foreign_key_check').all() as Array<{
    table: string;
    rowid: number | null;
    parent: string;
  }>;
  for (const violation of violations.slice(0, 20)) {
    issues.push(`foreign-key violation ${violation.table} row ${violation.rowid ?? '?'} -> ${violation.parent}`);
  }

  for (const [label, sql] of IMPLICIT_RELATION_CHECKS) {
    const row = db.prepare(sql).get() as { count: number };
    if (row.count > 0) issues.push(`${row.count} orphan ${label} record(s)`);
  }

  return issues.length === 0
    ? {
        id: 'database-relations', label: 'Database relations', status: 'pass',
        message: 'Foreign-key and core implicit relations OK.', hints: [],
      }
    : {
        id: 'database-relations', label: 'Database relations', status: 'warn',
        message: `${issues.length} database relation issue(s).`, hints: issues.slice(0, 20),
      };
}
