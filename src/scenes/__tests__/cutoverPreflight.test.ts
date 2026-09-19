import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { inspectSceneCutover } from '../cutoverPreflight.js';

describe('scene cutover preflight', () => {
  it('reports pending and unknown effects without exposing secrets or changing state', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE proactive_runs(status TEXT, private_prompt TEXT);
        INSERT INTO proactive_runs VALUES ('running', 'private content');
        CREATE TABLE heartbeat_checks(delivery_status TEXT);
        INSERT INTO heartbeat_checks VALUES ('unknown');
        CREATE TABLE proactive_web_push_keys(secret TEXT);
        INSERT INTO proactive_web_push_keys VALUES ('private key');
        CREATE TABLE unrelated_sessions(body TEXT);`);
      const before = db.prepare('SELECT total_changes() AS n').get()?.n;
      const report = inspectSceneCutover(db);
      expect(report.blockers).toEqual(['requires_reconciliation:heartbeat_checks:delivery_status', 'in_flight:proactive_runs:status']);
      expect(report.tables).toHaveLength(3);
      expect(report.tables.find((table) => table.name === 'proactive_web_push_keys')?.destination).toBe('notifications');
      expect(JSON.stringify(report)).not.toContain('private');
      expect(db.prepare('SELECT total_changes() AS n').get()?.n).toBe(before);
    } finally { db.close(); }
  });
  it('fails closed for new tables not yet included in conversion', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE proactive_new_feature(id TEXT)');
      expect(inspectSceneCutover(db).blockers).toEqual(['unmapped_table:proactive_new_feature']);
    } finally { db.close(); }
  });
});
