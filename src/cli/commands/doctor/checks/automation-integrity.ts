import { existsSync } from 'node:fs';

import { getSqliteDatabase, requireXopcDatabase } from '../../../../storage/sqlite/index.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkAutomationIntegrity(ctx: DoctorContext): Promise<CheckResult> {
  if (!ctx.options.deep) {
    return {
      id: 'automation-integrity', label: 'Automations', status: 'skip',
      message: 'Deep mode off; automation scan skipped.', hints: ['Run: xopc doctor --deep'],
    };
  }
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'automation-integrity', label: 'Automations', status: 'skip',
      message: 'No config file; skipped.', hints: [],
    };
  }

  requireXopcDatabase();
  const db = getSqliteDatabase();
  const issues: string[] = [];
  const orphanResults = db.prepare(`SELECT r.run_id FROM automation_results r
    LEFT JOIN automation_runs ar ON ar.run_id = r.run_id WHERE ar.run_id IS NULL LIMIT 20`).all() as Array<{ run_id: string }>;
  for (const row of orphanResults) issues.push(`orphan result ${row.run_id}`);
  const orphanResultDeliveries = db.prepare(`SELECT d.run_id, d.destination_key FROM automation_result_deliveries d
    LEFT JOIN automation_results r ON r.run_id = d.run_id WHERE r.run_id IS NULL LIMIT 20`).all() as Array<{
      run_id: string;
      destination_key: string;
    }>;
  for (const row of orphanResultDeliveries) issues.push(`orphan result delivery ${row.run_id}/${row.destination_key}`);
  const orphanEventRuns = db.prepare(`SELECT d.event_id, d.automation_id, d.run_id FROM automation_event_deliveries d
    LEFT JOIN automation_runs r ON r.run_id = d.run_id
    WHERE d.run_id IS NOT NULL AND r.run_id IS NULL LIMIT 20`).all() as Array<{
      event_id: string;
      automation_id: string;
      run_id: string;
    }>;
  for (const row of orphanEventRuns) issues.push(`orphan event delivery run ${row.event_id}/${row.automation_id}/${row.run_id}`);
  const expiredLeases = db.prepare(`SELECT
    (SELECT COUNT(*) FROM automation_events WHERE projection_status = 'projecting' AND projection_lease_until_ms <= ?) +
    (SELECT COUNT(*) FROM automation_event_deliveries WHERE lease_owner IS NOT NULL AND lease_until_ms <= ?) +
    (SELECT COUNT(*) FROM automation_result_deliveries WHERE status = 'delivering' AND lease_until_ms <= ?) AS count`)
    .get(Date.now(), Date.now(), Date.now()) as { count: number };
  if (expiredLeases.count > 0) issues.push(`${expiredLeases.count} expired automation lease(s) awaiting recovery`);

  return issues.length === 0
    ? { id: 'automation-integrity', label: 'Automations', status: 'pass', message: 'Automation state graph OK.', hints: [] }
    : { id: 'automation-integrity', label: 'Automations', status: 'warn', message: `${issues.length} automation integrity issue(s).`, hints: issues };
}
