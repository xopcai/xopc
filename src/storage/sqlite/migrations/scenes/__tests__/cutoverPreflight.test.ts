import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { inspectSceneCutover } from '../preflight.js';

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

  it('requires reconciliation for pending mobile scene sends without blocking unrelated notifications', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE notification_events(event_id TEXT PRIMARY KEY, event_type TEXT);
        CREATE TABLE notification_deliveries(event_id TEXT, status TEXT, provider_ticket_id TEXT);
        INSERT INTO notification_events VALUES ('scene', 'proactive.insight'), ('chat', 'chat.completed');
        INSERT INTO notification_deliveries VALUES ('chat', 'pending', NULL)`);
      expect(inspectSceneCutover(db).blockers).toEqual([]);
      db.exec("INSERT INTO notification_deliveries VALUES ('scene', 'pending', NULL)");
      expect(inspectSceneCutover(db).blockers).toEqual(['pending_effect:notification_deliveries:proactive.insight']);
      db.exec("UPDATE notification_deliveries SET status = 'accepted' WHERE event_id = 'scene'");
      expect(inspectSceneCutover(db).blockers).toEqual(['requires_reconciliation:notification_deliveries:proactive.insight']);
      db.exec("UPDATE notification_deliveries SET provider_ticket_id = 'receipt' WHERE event_id = 'scene'");
      expect(inspectSceneCutover(db).blockers).toEqual([]);
    } finally { db.close(); }
  });
  it('blocks delivery leases and executing insight actions', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE proactive_delivery_outbox(status TEXT);
        INSERT INTO proactive_delivery_outbox VALUES ('delivering');
        CREATE TABLE proactive_insights(action_status TEXT);
        INSERT INTO proactive_insights VALUES ('executing');`);
      expect(inspectSceneCutover(db).blockers).toEqual([
        'in_flight:proactive_delivery_outbox:status', 'in_flight:proactive_insights:action_status',
      ]);
    } finally { db.close(); }
  });

  it('requires explicit handling of pending writes but not read-only retries', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE proactive_insights(action_status TEXT);
        INSERT INTO proactive_insights VALUES ('pending'), ('approval_required');
        CREATE TABLE proactive_delivery_outbox(status TEXT);
        INSERT INTO proactive_delivery_outbox VALUES ('retryable');
        CREATE TABLE proactive_web_push_deliveries(status TEXT);
        INSERT INTO proactive_web_push_deliveries VALUES ('pending');
        CREATE TABLE proactive_channel_deliveries(status TEXT);
        INSERT INTO proactive_channel_deliveries VALUES ('pending');
        CREATE TABLE heartbeat_checks(delivery_status TEXT);
        INSERT INTO heartbeat_checks VALUES ('pending');
        CREATE TABLE proactive_runs(status TEXT);
        INSERT INTO proactive_runs VALUES ('retryable');`);
      expect(inspectSceneCutover(db).blockers).toEqual([
        'pending_effect:heartbeat_checks:delivery_status',
        'pending_effect:proactive_channel_deliveries:status',
        'pending_effect:proactive_delivery_outbox:status',
        'pending_effect:proactive_insights:action_status',
        'pending_effect:proactive_web_push_deliveries:status',
      ]);
    } finally { db.close(); }
  });

  it('never treats a heartbeat bus handoff as a delivery receipt', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE heartbeat_checks(delivery_status TEXT);
        INSERT INTO heartbeat_checks VALUES ('queued'), ('unknown'), ('none'), ('expired'), ('cancelled');`);
      expect(inspectSceneCutover(db).blockers).toEqual(['requires_reconciliation:heartbeat_checks:delivery_status']);
    } finally { db.close(); }
  });
});
