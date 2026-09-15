import { listMailFollowUps } from './follow-ups.js';
import { z } from 'zod';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { getCard } from './inbox/cards.js';
import { effectiveProactivePolicy, ProactiveConflict } from './policy/service.js';
import { controlledSubscriptions, createControlledSubscription, requireSubscription, updateControlledSubscription } from './scenarios/control.js';
import { ProactiveScenarioService } from './scenarios/service.js';
import { ProactiveEventService } from './service.js';
import { scanDueProjects } from './temporal/schedule.js';

type SceneKind = 'project_momentum' | 'meeting_preparation' | 'communication_follow_up';
type SceneStatus = 'needs_decision' | 'prepared' | 'changed' | 'following';

interface SceneMoment {
  id: string;
  kind: SceneKind;
  status: SceneStatus;
  title: string;
  promise: string;
  moment: string;
  relevance: string;
  help: string;
  arrangementId: string;
  manageRoute: string;
  object: { label: string; route: string } | null;
  card: ReturnType<typeof getCard> | null;
  updatedAt: string;
}

const DelegateSchema = z.object({
  scenarioKey: z.enum(['project_delivery_risk', 'meeting_preparation', 'discussion_follow_up']),
  projectId: z.string().min(1).optional(),
  instructions: z.string().trim().min(1).max(12000),
}).strict();

export function startDelegation(workspace: string, value: unknown) {
  const input = DelegateSchema.parse(value);
  if (input.scenarioKey === 'project_delivery_risk' && !input.projectId) throw new Error('Choose a project');
  if (input.scenarioKey !== 'project_delivery_risk' && input.projectId) throw new Error('This service uses workspace sources');
  const subscription = createControlledSubscription(workspace, {
    scenarioKey: input.scenarioKey, scopeKind: input.projectId ? 'project' : 'workspace',
    scopeId: input.projectId ?? workspace, userInstructions: input.instructions,
  });
  if (input.projectId && effectiveProactivePolicy(subscription.id).enabled) checkDelegation(workspace, subscription.id);
  return subscription;
}

/** Queue work in the existing worker; HTTP and conversation requests do not own model runs. */
export function checkDelegation(workspace: string, id: string) {
  const sub = requireSubscription(id, workspace);
  if (!effectiveProactivePolicy(id).enabled) throw new Error('Resume this service before checking');
  if (sub.scopeKind !== 'project') throw new Error('This service checks when connected sources change');
  return runSqliteWriteTransaction((db) => {
    const retry = db.prepare("SELECT run_id FROM proactive_runs WHERE subscription_id = ? AND status = 'retryable' ORDER BY started_at DESC LIMIT 1").get(id) as { run_id: string } | undefined;
    if (retry) {
      db.prepare("UPDATE proactive_runs SET next_attempt_at = ? WHERE run_id = ? AND status = 'retryable'").run(new Date().toISOString(), retry.run_id);
      return { status: 'queued' as const };
    }
    const running = db.prepare("SELECT 1 FROM proactive_signal_batches WHERE subscription_id = ? AND status IN ('collecting', 'ready', 'processing')").get(id);
    if (running) return { status: 'queued' as const };
    const last = db.prepare('SELECT MAX(started_at) AS at FROM proactive_runs WHERE subscription_id = ?').get(id) as { at: string | null };
    if (last.at && Date.parse(last.at) > Date.now() - 60000) throw new ProactiveConflict('A check just finished; try again in a minute');
    db.prepare(`INSERT INTO proactive_schedule_state(subscription_id, next_due_at) VALUES (?, ?)
      ON CONFLICT(subscription_id) DO UPDATE SET next_due_at = excluded.next_due_at, last_fingerprint = NULL`).run(id, new Date().toISOString());
    scanDueProjects(new ProactiveEventService(() => new ProactiveScenarioService().routes()));
    db.prepare("UPDATE proactive_signal_batches SET ready_at = ?, status = 'ready' WHERE subscription_id = ? AND status = 'collecting'").run(new Date().toISOString(), id);
    return { status: 'queued' as const };
  });
}

export function delegationOverview(workspace: string) {
  const db = getSqliteDatabase();
  const now = new Date().toISOString();
  const rows = db.prepare(`SELECT i.inbox_item_id FROM proactive_inbox_items i
    JOIN proactive_insights x USING(insight_id) JOIN proactive_scenario_subscriptions s USING(subscription_id)
    WHERE s.workspace_id = ? AND i.withdrawn_at IS NULL AND i.status IN ('unread', 'read')
    AND (i.expires_at IS NULL OR i.expires_at > ?)
    ORDER BY CASE WHEN x.action_status = 'approval_required' THEN 0 WHEN x.artifact_json IS NOT NULL THEN 1 ELSE 2 END,
    x.value_score DESC, i.updated_at DESC LIMIT 100`).all(workspace, now) as Array<{ inbox_item_id: string }>;
  const cards = rows.map(row => getCard(row.inbox_item_id, workspace)).filter(card => !['withdrawn', 'expired'].includes(card.status));
  const followUps = listMailFollowUps(workspace);
  const delegations = controlledSubscriptions(workspace).map(sub => ({
    id: sub.id,
    scenarioKey: sub.scenarioKey,
    scopeKind: sub.scopeKind,
    scopeId: sub.scopeId,
    enabled: sub.enabled,
    revision: sub.revision,
    delivery: sub.delivery,
    completedAt: sub.completedAt,
    userInstructions: sub.userInstructions,
    updatedAt: sub.updatedAt,
    effectiveEnabled: effectiveProactivePolicy(sub.id).enabled,
    project: sub.scopeKind === 'project' ? (db.prepare('SELECT name, status FROM projects WHERE project_id = ?').get(sub.scopeId) as { name: string; status: string } | undefined) ?? null : null,
    projectMonitoring: sub.scopeKind === 'project' ? projectMonitoring(sub.scopeId) : null,
    checking: Boolean(db.prepare("SELECT 1 FROM proactive_signal_batches WHERE subscription_id = ? AND status IN ('collecting', 'ready', 'processing')").get(sub.id)),
  }));
  return {
    scenes: projectSceneMoments(cards, delegations, followUps),
    followUps,
    delegations,
  };
}

function projectMonitoring(projectId: string) {
  const row = getSqliteDatabase().prepare('SELECT mode, allowed_actions_json FROM project_monitoring_policies WHERE project_id = ?').get(projectId) as { mode: 'observe' | 'ask_before_action' | 'auto_low_risk'; allowed_actions_json: string } | undefined;
  return row ? { mode: row.mode, allowedActions: JSON.parse(row.allowed_actions_json) as string[] } : { mode: 'observe' as const, allowedActions: [] };
}

function projectSceneMoments(
  cards: ReturnType<typeof getCard>[],
  delegations: Array<{
    id: string; scenarioKey: string; scopeKind: 'workspace' | 'project'; scopeId: string; enabled: boolean;
    revision: number; delivery: 'inbox' | 'important' | 'digest'; completedAt: string | null;
    userInstructions: string; updatedAt: string; effectiveEnabled: boolean;
    project: { name: string; status: string } | null;
    projectMonitoring: ReturnType<typeof projectMonitoring> | null;
    checking: boolean;
  }>,
  followUps: ReturnType<typeof listMailFollowUps>,
): SceneMoment[] {
  const latestCardBySubscription = new Map<string, ReturnType<typeof getCard>>();
  for (const card of cards) {
    const previous = latestCardBySubscription.get(card.subscriptionId);
    if (!previous || previous.updatedAt < card.updatedAt) latestCardBySubscription.set(card.subscriptionId, card);
  }

  const moments: SceneMoment[] = [];
  for (const sub of delegations) {
    if (!sub.effectiveEnabled || sub.completedAt || !['project_delivery_risk', 'meeting_preparation', 'discussion_follow_up'].includes(sub.scenarioKey)) continue;
    const card = latestCardBySubscription.get(sub.id) ?? null;
    const project = sub.project;
    const kind: SceneKind = sub.scenarioKey === 'meeting_preparation' ? 'meeting_preparation'
      : sub.scenarioKey === 'discussion_follow_up' ? 'communication_follow_up' : 'project_momentum';
    const object = project
      ? { label: project.name, route: `/projects/${encodeURIComponent(sub.scopeId)}` }
      : card?.evidence.find(item => item.route) ? (() => { const item = card.evidence.find(value => value.route)!; return { label: item.label, route: item.route! }; })() : null;
    moments.push({
      id: `scene:${sub.id}`,
      kind,
      status: sceneStatus(card),
      title: project?.name ?? card?.title ?? (kind === 'meeting_preparation' ? 'Meeting preparation' : kind === 'communication_follow_up' ? 'Conversation follow-up' : 'Project follow-through'),
      promise: sub.userInstructions,
      moment: card?.whyNow ?? (kind === 'meeting_preparation' ? 'Waiting for the next relevant meeting' : kind === 'communication_follow_up' ? 'Watching for a meaningful follow-up' : 'Watching the project for a meaningful change'),
      relevance: card?.summary ?? sub.userInstructions,
      help: card?.workDone || card?.recommendation || (kind === 'meeting_preparation' ? 'I will bring back a brief before the meeting.' : kind === 'communication_follow_up' ? 'I will return when the discussion needs a next step.' : 'I will return when the goal, commitment, or delivery risk changes.'),
      arrangementId: sub.id,
      manageRoute: `/assistant-work?delegation=${encodeURIComponent(sub.id)}`,
      object,
      card,
      updatedAt: card?.updatedAt ?? sub.updatedAt,
    });
  }

  for (const follow of followUps) {
    if (!follow.enabled || follow.status !== 'watching') continue;
    const card = cards.find(item => item.communication?.id === follow.id) ?? null;
    moments.push({
      id: `scene:${follow.id}`,
      kind: 'communication_follow_up',
      status: sceneStatus(card),
      title: follow.subject ?? 'Communication follow-up',
      promise: follow.instructions,
      moment: card?.whyNow ?? (follow.latestDirection === 'received' ? 'A reply arrived' : `Waiting until ${follow.dueAt}`),
      relevance: card?.summary ?? follow.instructions,
      help: card?.workDone || card?.recommendation || 'I will watch the thread and prepare the next step when it matters.',
      arrangementId: follow.subscriptionId,
      manageRoute: `/assistant-work?follow-up=${encodeURIComponent(follow.id)}`,
      object: follow.sessionKey ? { label: follow.subject ?? 'Open conversation', route: `/chat/${encodeURIComponent(follow.sessionKey)}` } : null,
      card,
      updatedAt: card?.updatedAt ?? follow.lastCheckedAt ?? follow.dueAt,
    });
  }

  const priority: Record<SceneStatus, number> = { needs_decision: 0, prepared: 1, changed: 2, following: 3 };
  return moments.sort((a, b) => priority[a.status] - priority[b.status] || b.updatedAt.localeCompare(a.updatedAt));
}

function sceneStatus(card: ReturnType<typeof getCard> | null): SceneStatus {
  if (!card) return 'following';
  if (card.decision && card.actionStatus !== 'completed') return 'needs_decision';
  if (card.artifact) return 'prepared';
  return 'changed';
}

export function completeDeliveredProjects(now = new Date()) {
  const db = getSqliteDatabase();
  const rows = db.prepare(`SELECT s.subscription_id, s.workspace_id FROM proactive_scenario_subscriptions s
    JOIN projects p ON p.project_id = s.scope_id WHERE s.scope_kind = 'project' AND s.enabled = 1
    AND p.status IN ('completed', 'cancelled', 'archived')`).all() as Array<{ subscription_id: string; workspace_id: string }>;
  for (const row of rows) {
    const current = controlledSubscriptions(row.workspace_id).find(sub => sub.id === row.subscription_id)!;
    updateControlledSubscription(row.workspace_id, row.subscription_id, { expectedRevision: current.revision, enabled: false, completedAt: now.toISOString() });
    db.prepare(`UPDATE proactive_inbox_items SET status = 'resolved', resolution = 'project_ended', updated_at = ?
      WHERE insight_id IN (SELECT insight_id FROM proactive_insights WHERE subscription_id = ?) AND status <> 'resolved'`).run(now.toISOString(), row.subscription_id);
  }
}
