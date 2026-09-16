import { randomUUID } from 'node:crypto';

import { sourceFreshness } from './source-freshness.js';
import { z } from 'zod';

import { listKnowledgeSourceItems } from '../storage/sqlite/knowledge-repository.js';
import { getConnectorConnection } from '../storage/sqlite/connector-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { authorizedConnectedSource } from './execution/authorization.js';
import { emailFields, readMailThread } from './mail-thread.js';
import { effectiveProactivePolicy, ProactiveConflict } from './policy/service.js';
import { createControlledSubscription } from './scenarios/control.js';
import { listSubscriptions } from './scenarios/repository.js';
import { ProactiveScenarioService } from './scenarios/service.js';
import { ProactiveEventService } from './service.js';

export const COMMUNICATION_SCENARIO = 'communication_follow_up';
export type MailFollowUp = {
  id: string; subscription_id: string; workspace_id: string; source_item_id: string; instructions: string;
  due_at: string; status: 'watching' | 'paused' | 'completed'; revision: number;
  last_fingerprint: string | null; last_checked_at: string | null; session_key: string | null;
};
const CreateSchema = z.object({ sourceItemId: z.string().min(1), instructions: z.string().trim().min(1).max(12000), dueAt: z.string().datetime() }).strict();
const UpdateSchema = z.object({ expectedRevision: z.number().int().positive(), instructions: z.string().trim().min(1).max(12000).optional(), dueAt: z.string().datetime().optional(), status: z.enum(['watching', 'paused', 'completed']).optional() }).strict();

export function requireMailFollowUp(workspace: string, id: string): MailFollowUp {
  const row = getSqliteDatabase().prepare('SELECT * FROM proactive_follow_ups WHERE id = ? AND workspace_id = ?').get(id, workspace) as MailFollowUp | undefined;
  if (!row) throw new Error('Follow-up not found');
  return row;
}

export function authorizedMailThread(follow: MailFollowUp) {
  if (!authorizedConnectedSource(follow.source_item_id, follow.workspace_id, COMMUNICATION_SCENARIO)) return null;
  const thread = readMailThread(follow.source_item_id);
  if (!thread || thread.items.some(item => !authorizedConnectedSource(item.id, follow.workspace_id, COMMUNICATION_SCENARIO)
    || item.metadata.connectionId !== thread.origin.metadata.connectionId)) return null;
  return thread;
}

export function mailFollowUpView(follow: MailFollowUp) {
  const thread = authorizedMailThread(follow);
  const latest = thread?.items.at(-1);
  const sync = sourceFreshness(follow.source_item_id, Date.parse(follow.due_at) <= Date.now() ? follow.due_at : undefined);
  return {
    id: follow.id, subscriptionId: follow.subscription_id, instructions: follow.instructions, dueAt: follow.due_at,
    status: follow.status, revision: follow.revision, lastCheckedAt: follow.last_checked_at, sessionKey: follow.session_key,
    sourceAvailable: Boolean(thread), enabled: follow.status === 'watching' && effectiveProactivePolicy(follow.subscription_id).enabled,
    subject: thread ? emailFields(thread.origin.normalizedText).subject ?? 'Email follow-up' : null,
    latestMessageAt: latest?.occurredAt ?? null,
    latestDirection: latest ? emailFields(latest.normalizedText).labels?.includes('SENT') ? 'sent' : emailFields(latest.normalizedText).labels?.includes('INBOX') ? 'received' : 'unknown' : null,
    lastSyncedAt: sync.lastSyncedAt, syncFailed: sync.syncFailed, sourceFresh: sync.fresh,
  };
}

export function listMailFollowUps(workspace: string) {
  return (getSqliteDatabase().prepare('SELECT * FROM proactive_follow_ups WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspace) as MailFollowUp[]).map(mailFollowUpView);
}

export function mailFollowUpSources(workspace: string) {
  const seen = new Set<string>();
  return listKnowledgeSourceItems({ itemType: 'email', limit: 500 }).flatMap(item => {
    if (!authorizedConnectedSource(item.id, workspace, COMMUNICATION_SCENARIO)) return [];
    const thread = readMailThread(item.id);
    if (!thread || seen.has(thread.threadKey)) return [];
    seen.add(thread.threadKey);
    const fields = emailFields(item.normalizedText);
    const connection = getConnectorConnection(String(item.metadata.connectionId));
    const account = connection?.alias ?? connection?.identity.email ?? connection?.identity.name;
    return [{ id: item.id, subject: fields.subject ?? 'Email', sender: fields.sender ?? '', occurredAt: item.occurredAt,
      accountLabel: typeof account === 'string' ? account : 'Connected email account' }];
  }).slice(0, 100);
}

export function startMailFollowUp(workspace: string, value: unknown) {
  const input = CreateSchema.parse(value);
  if (Date.parse(input.dueAt) <= Date.now()) throw new Error('Choose a future follow-up time');
  if (!authorizedConnectedSource(input.sourceItemId, workspace, COMMUNICATION_SCENARIO)) throw new Error('Authorize this email account for proactive follow-up first');
  const thread = readMailThread(input.sourceItemId);
  if (!thread) throw new Error('This email has no available thread');
  return runSqliteWriteTransaction(db => {
    if (db.prepare('SELECT 1 FROM proactive_follow_ups WHERE workspace_id = ? AND thread_key = ?').get(workspace, thread.threadKey)) throw new ProactiveConflict('This conversation is already delegated; update the existing follow-up');
    const sub = listSubscriptions(COMMUNICATION_SCENARIO).find(item => item.workspaceId === workspace)
      ?? createControlledSubscription(workspace, { scenarioKey: COMMUNICATION_SCENARIO, scopeKind: 'workspace', scopeId: workspace });
    const id = randomUUID(); const now = new Date().toISOString();
    db.prepare(`INSERT INTO proactive_follow_ups(id, subscription_id, workspace_id, source_item_id, thread_key, instructions, due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sub.id, workspace, input.sourceItemId, thread.threadKey, input.instructions, input.dueAt, now, now);
    scanMailFollowUps(new ProactiveEventService(() => new ProactiveScenarioService().routes()));
    return mailFollowUpView(requireMailFollowUp(workspace, id));
  });
}

export function updateMailFollowUp(workspace: string, id: string, value: unknown) {
  const input = UpdateSchema.parse(value);
  return runSqliteWriteTransaction(db => {
    const row = requireMailFollowUp(workspace, id);
    if (row.revision !== input.expectedRevision) throw new ProactiveConflict('Follow-up changed; refresh before editing');
    if (input.dueAt && Date.parse(input.dueAt) <= Date.now()) throw new Error('Choose a future follow-up time');
    db.prepare(`UPDATE proactive_follow_ups SET instructions = ?, due_at = ?, status = ?, revision = revision + 1,
      last_fingerprint = NULL, updated_at = ? WHERE id = ?`).run(input.instructions ?? row.instructions, input.dueAt ?? row.due_at, input.status ?? row.status, new Date().toISOString(), id);
    scanMailFollowUps(new ProactiveEventService(() => new ProactiveScenarioService().routes()));
    return mailFollowUpView(requireMailFollowUp(workspace, id));
  });
}

/** Keep the existing chat and its exact connector confirmation flow as the write boundary. */
export function continueMailFollowUp(workspace: string, id: string, sessionKey: string) {
  const follow = requireMailFollowUp(workspace, id);
  const thread = authorizedMailThread(follow);
  if (!thread || follow.status !== 'watching' || !effectiveProactivePolicy(follow.subscription_id).enabled) throw new Error('Resume and authorize this follow-up before continuing');
  getSqliteDatabase().prepare('UPDATE proactive_follow_ups SET session_key = ? WHERE id = ?').run(sessionKey, id);
  return { followUp: mailFollowUpView(requireMailFollowUp(workspace, id)), connectionId: thread.origin.metadata.connectionId,
    sourceItemId: thread.origin.id, threadId: emailFields(thread.origin.normalizedText).threadId,
    instruction: 'Read the current card and latest thread using this exact connection. Review the recipients and complete draft with the user before sending through the connector approval flow. Never infer successful delivery from a draft or approval. Use provider results, then continue watching synchronized replies.' };
}

/** Poll only delegated threads; unchanged threads and passed deadlines produce no repeat signals. */
export function scanMailFollowUps(events: ProactiveEventService, now = new Date()) {
  const db = getSqliteDatabase(); let published = 0;
  for (const follow of db.prepare("SELECT * FROM proactive_follow_ups WHERE status = 'watching'").all() as MailFollowUp[]) {
    const policy = effectiveProactivePolicy(follow.subscription_id, now);
    if (!policy.enabled) continue;
    const thread = authorizedMailThread(follow);
    if (!thread) continue;
    const freshness = sourceFreshness(follow.source_item_id, Date.parse(follow.due_at) <= now.getTime() ? follow.due_at : undefined, now.getTime());
    if (!freshness.fresh) { db.prepare('UPDATE proactive_follow_ups SET last_fingerprint = NULL WHERE id = ?').run(follow.id); continue; }
    const fingerprint = `${follow.revision}:${thread.fingerprint}:${Date.parse(follow.due_at) <= now.getTime() ? 'due' : 'waiting'}`;
    const awaitingSource = db.prepare(`SELECT 1 FROM proactive_runs r JOIN proactive_batch_events be USING(batch_id)
      JOIN proactive_events e USING(event_id) WHERE r.subscription_id = ? AND r.status = 'retryable'
      AND r.outcome_reason = 'source_stale' AND e.subject_kind = 'mail_follow_up' AND e.subject_id = ? LIMIT 1`)
      .get(follow.subscription_id, follow.id);
    if (fingerprint !== follow.last_fingerprint && !awaitingSource) {
      const result = events.publish({ type: 'proactive.follow_up.v1', schemaVersion: 1,
        source: { kind: 'connector', id: String(thread.origin.metadata.connectionId) }, subject: { kind: 'mail_follow_up', id: follow.id },
        actor: { kind: 'system' }, scope: { workspaceId: follow.workspace_id }, occurredAt: now.toISOString(),
        dedupeKey: `mail-follow-up:${follow.id}:${fingerprint}:${freshness.version}:${policy.preferences.revision}`, sensitivity: 'personal', payload: { followUpId: follow.id } }, now);
      if (result.inserted) published++;
    }
    db.prepare('UPDATE proactive_follow_ups SET last_fingerprint = ?, last_checked_at = ? WHERE id = ?').run(fingerprint, now.toISOString(), follow.id);
  }
  return published;
}
