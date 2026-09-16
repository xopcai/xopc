import { createHash, randomUUID } from 'node:crypto';

import type { MessageBus } from '../../infra/bus/index.js';
import { proactiveChecksAllowed, proactivePreferences, quietHoursEnd } from '../../proactive/policy/service.js';
import { reserveWorkspaceAttention } from '../../proactive/inbox/digest.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

export interface HeartbeatCheck {
  id: string; startedAt: string; completedAt: string | null; status: string; detail: string | null;
  content: string | null; deliveryStatus: string; target: string | null; chatId: string | null;
}

export function beginHeartbeatCheck(workspace: string): string {
  const id = randomUUID();
  const now = new Date();
  const db = getSqliteDatabase();
  db.prepare('DELETE FROM heartbeat_checks WHERE workspace_id = ? AND started_at < ?').run(workspace, new Date(now.getTime() - 30 * 86400000).toISOString());
  db.prepare('INSERT INTO heartbeat_checks(id, workspace_id, started_at, status, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, workspace, now.toISOString(), 'running', new Date(now.getTime() + 86400000).toISOString());
  return id;
}

export function completeHeartbeatCheck(id: string, status: string, detail?: string, content?: string, target?: string, chatId?: string): void {
  runSqliteWriteTransaction(db => {
    const row = db.prepare('SELECT workspace_id FROM heartbeat_checks WHERE id = ?').get(id) as { workspace_id: string };
    const fingerprint = content ? createHash('sha256').update(JSON.stringify([target, chatId, content.trim()])).digest('hex') : null;
    const duplicate = fingerprint && db.prepare(`SELECT 1 FROM heartbeat_checks WHERE workspace_id = ? AND fingerprint = ?
      AND delivery_status IN ('pending', 'sending', 'queued', 'unknown') AND expires_at > ? AND id <> ?`).get(row.workspace_id, fingerprint, new Date().toISOString(), id);
    const delivery = duplicate ? 'duplicate' : status === 'prepared' ? target && chatId ? 'pending' : 'no_target' : 'none';
    db.prepare(`UPDATE heartbeat_checks SET status = ?, detail = ?, content = ?, target = ?, chat_id = ?, fingerprint = ?,
      delivery_status = ?, completed_at = ?, next_attempt_at = ? WHERE id = ? AND status = 'running'`)
      .run(status, detail?.slice(0, 500) ?? null, content?.slice(0, 20000) ?? null, target ?? null, chatId ?? null, fingerprint,
        delivery, new Date().toISOString(), new Date().toISOString(), id);
  });
}

export function recentHeartbeatChecks(workspace: string): HeartbeatCheck[] {
  return getSqliteDatabase().prepare(`SELECT id, started_at AS startedAt, completed_at AS completedAt, status, detail, content,
    delivery_status AS deliveryStatus, target, chat_id AS chatId FROM heartbeat_checks WHERE workspace_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 10`).all(workspace) as unknown as HeartbeatCheck[];
}

export function recoverHeartbeatChecks(workspace: string): void {
  const db = getSqliteDatabase();
  db.prepare("UPDATE heartbeat_checks SET delivery_status = 'unknown', detail = 'Delivery interrupted; verify before sending again' WHERE workspace_id = ? AND delivery_status = 'sending'").run(workspace);
  db.prepare("UPDATE heartbeat_checks SET status = 'interrupted', completed_at = ? WHERE workspace_id = ? AND status = 'running'").run(new Date().toISOString(), workspace);
}

/** Claim before publishing: an ambiguous bus handoff is never blindly replayed. */
export async function deliverHeartbeatChecks(workspace: string, bus: Pick<MessageBus, 'publishOutbound'>, target?: string, chatId?: string): Promise<void> {
  const claim = runSqliteWriteTransaction(db => {
    const now = new Date();
    db.prepare("UPDATE heartbeat_checks SET delivery_status = 'expired' WHERE workspace_id = ? AND delivery_status = 'pending' AND expires_at <= ?").run(workspace, now.toISOString());
    const row = db.prepare("SELECT * FROM heartbeat_checks WHERE workspace_id = ? AND delivery_status = 'pending' AND next_attempt_at <= ? ORDER BY started_at LIMIT 1").get(workspace, now.toISOString()) as { id: string; content: string; target: string; chat_id: string } | undefined;
    if (!row) return null;
    if (row.target !== target || row.chat_id !== chatId) { db.prepare("UPDATE heartbeat_checks SET delivery_status = 'cancelled', detail = 'Delivery target changed' WHERE id = ?").run(row.id); return null; }
    const preferences = proactivePreferences(workspace);
    if (!proactiveChecksAllowed(preferences, now) || preferences.notificationsMuted || preferences.level === 'quiet') return null;
    const quietEnd = quietHoursEnd(preferences, now);
    if (quietEnd) { db.prepare('UPDATE heartbeat_checks SET next_attempt_at = ? WHERE id = ?').run(quietEnd.toISOString(), row.id); return null; }
    if (!reserveWorkspaceAttention(workspace, `heartbeat:${row.id}`, now)) return null;
    db.prepare("UPDATE heartbeat_checks SET delivery_status = 'sending' WHERE id = ? AND delivery_status = 'pending'").run(row.id);
    return row;
  });
  if (!claim) return;
  try {
    await bus.publishOutbound({ channel: claim.target, chat_id: claim.chat_id, content: claim.content, type: 'message' });
    getSqliteDatabase().prepare("UPDATE heartbeat_checks SET delivery_status = 'queued' WHERE id = ? AND delivery_status = 'sending'").run(claim.id);
  } catch {
    getSqliteDatabase().prepare("UPDATE heartbeat_checks SET delivery_status = 'unknown', detail = 'Outbound handoff failed; verify before sending again' WHERE id = ?").run(claim.id);
  }
}
