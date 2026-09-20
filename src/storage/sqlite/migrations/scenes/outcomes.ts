import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { sceneContentHash } from './targetContract.js';
import { resolveSceneCutoverBindings, type SceneCutoverBindings } from './bindings.js';

const id = z.string().min(1);
const time = z.string().datetime({ offset: true }).transform((value) => Date.parse(value)).pipe(z.number().int().nonnegative());
const json = z.string().transform((value) => JSON.parse(value) as unknown).transform((value) => { sceneContentHash(value); return value; });
const insightSchema = z.strictObject({
  insight_id: id, run_id: id, subscription_id: id, scenario_key: id,
  title: z.string(), summary: z.string(), why_now: z.string(), impact: z.string(), recommendation: z.string(), work_done: z.string(),
  urgency: z.enum(['low', 'medium', 'high', 'critical']), confidence: z.number().min(0).max(1), value_score: z.number().min(0).max(1),
  evidence_ids_json: json.pipe(z.array(id)), created_at: time, decision_json: json.nullable(), content_fingerprint: z.string().nullable(),
  proposed_action_json: json.nullable(), disposition: z.enum(['record_silently', 'show_in_work', 'request_approval', 'auto_execute']).nullable(),
  disposition_reason: z.string().nullable(), disposition_at: time.nullable(),
  action_status: z.enum(['not_authorized', 'approval_required', 'pending', 'executing', 'completed', 'rejected', 'failed']).nullable(),
  action_result_json: json.nullable(), action_error: z.string().nullable(), action_updated_at: time.nullable(),
  artifact_json: json.nullable(), artifact_edited_at: time.nullable(),
});
const cardSchema = z.strictObject({
  inbox_item_id: id, insight_id: id, status: z.enum(['unread', 'read', 'snoozed', 'resolved']),
  snoozed_until: time.nullable(), resolution: z.string().nullable(), created_at: time, updated_at: time,
  revision: z.number().int().positive(), notification_revision: z.number().int().positive(),
  expires_at: time.nullable(), withdrawn_at: time.nullable(), actionable_until: time.nullable(), correlation_key: z.string().nullable(),
});

/** Imports user-visible results and their audit trail; embedded action history grants no execution authority. */
export function convertSceneOutcomeHistory(db: DatabaseSync, input: { owners: SceneCutoverBindings }) {
  const owners = new Map(resolveSceneCutoverBindings(db, input.owners).map((row) => [row.workspaceId, row.ownerId]));
  const read = <T>(table: string, schema: z.ZodType<T>): T[] => {
    const rows = db.prepare(`SELECT * FROM ${table} LIMIT 100001`).all();
    if (rows.length > 100_000) throw new Error(`Outcome conversion exceeds reviewed limit: ${table}`);
    return rows.map((row) => schema.parse(row));
  };
  const insights = read('proactive_insights', insightSchema);
  const cards = read('proactive_inbox_items', cardSchema);
  const decisions = read('proactive_decisions', z.strictObject({ decision_id: id, inbox_item_id: id, choice: z.string(), note: z.string(), created_at: time }));
  const instructions = read('proactive_instruction_feedback', z.strictObject({ instruction_id: id, inbox_item_id: id, prompt_revision_id: id, instruction: z.string(), created_at: time }));
  const requests = read('proactive_card_actions', z.strictObject({ idempotency_key: id, inbox_item_id: id, request_json: json, response_json: json }));
  const reviews = read('proactive_card_review_state', z.strictObject({ inbox_item_id: id, checked_at: time }));
  const changes = read('proactive_card_changes', z.strictObject({ sequence: z.number().int().positive(), workspace_id: id, inbox_item_id: id, deleted: z.union([z.literal(0), z.literal(1)]) }));
  const insightMap = new Map(insights.map((row) => [row.insight_id, row]));
  const cardMap = new Map(cards.map((row) => [row.inbox_item_id, row]));
  const deletedCards = new Set(changes.filter((row) => row.deleted === 1).map((row) => JSON.stringify([row.workspace_id, row.inbox_item_id])));
  const changeWorkspaces = new Map<string, string>();
  const scopes = new Map<string, string>();
  const requireCard = (cardId: string) => { if (!cardMap.has(cardId)) throw new Error('Outcome audit references a missing presentation'); };
  db.exec('SAVEPOINT scene_outcome_conversion');
  try {
    for (const insight of insights) {
      const run = db.prepare(`SELECT a.owner_id, a.workspace_id, r.origin, d.source_subscription_id, d.source_template_key
        FROM scene_runs r JOIN scene_activations a ON a.id = r.activation_id JOIN scene_run_details d ON d.run_id = r.id WHERE r.id = ?`).get(insight.run_id);
      const subscription = db.prepare('SELECT workspace_id, scenario_key FROM proactive_scenario_subscriptions WHERE subscription_id = ?').get(insight.subscription_id);
      if (!run || !subscription || run.origin !== 'import' || run.source_subscription_id !== insight.subscription_id
        || run.source_template_key !== insight.scenario_key || subscription.scenario_key !== insight.scenario_key
        || run.workspace_id !== subscription.workspace_id || owners.get(String(run.workspace_id)) !== run.owner_id) throw new Error('Outcome run identity or ownership mismatch');
      if (insight.action_status === 'pending' || insight.action_status === 'executing') throw new Error('Outcome action requires offline reconciliation');
      scopes.set(insight.insight_id, String(run.workspace_id));
      const kind = insight.artifact_json !== null ? 'artifact' : insight.decision_json !== null ? 'decision' : 'observation';
      const content = { kind, summary: insight.summary, evidenceIds: insight.evidence_ids_json,
        title: insight.title, whyNow: insight.why_now, impact: insight.impact, recommendation: insight.recommendation,
        workDone: insight.work_done, urgency: insight.urgency, confidence: insight.confidence, valueScore: insight.value_score,
        decision: insight.decision_json, contentFingerprint: insight.content_fingerprint,
        artifact: insight.artifact_json, artifactEditedAt: insight.artifact_edited_at,
        presentationDecision: { kind: insight.disposition, reason: insight.disposition_reason, recordedAt: insight.disposition_at },
        actionHistory: { proposedPlan: insight.proposed_action_json, recordedStatus: insight.action_status,
          recordedResult: insight.action_result_json, error: insight.action_error, updatedAt: insight.action_updated_at },
      };
      db.prepare('INSERT INTO scene_outcomes VALUES (?, ?, ?, ?, ?)').run(insight.insight_id, insight.run_id, kind, JSON.stringify(content), insight.created_at);
    }
    for (const card of cards) {
      if (!insightMap.has(card.insight_id)) throw new Error('Presentation references a missing outcome');
      db.prepare(`INSERT INTO scene_presentations(id, outcome_id, destination, status, created_at, updated_at, snoozed_until,
        expires_at, withdrawn_at, actionable_until, resolution, revision, notification_revision, correlation_key)
        VALUES (?, ?, 'inbox', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(card.inbox_item_id, card.insight_id, card.status,
          card.created_at, card.updated_at, card.snoozed_until, card.expires_at, card.withdrawn_at, card.actionable_until,
          card.resolution, card.revision, card.notification_revision, card.correlation_key);
    }
    for (const row of decisions) {
      requireCard(row.inbox_item_id);
      db.prepare("INSERT INTO scene_decisions VALUES (?, ?, ?, ?, ?, 'import')").run(row.decision_id, row.inbox_item_id, row.choice, row.note, row.created_at);
    }
    for (const row of instructions) {
      requireCard(row.inbox_item_id);
      const insight = insightMap.get(cardMap.get(row.inbox_item_id)!.insight_id)!;
      if (db.prepare('SELECT subscription_id FROM proactive_prompt_revisions WHERE revision_id = ?').get(row.prompt_revision_id)?.subscription_id !== insight.subscription_id) throw new Error('Instruction feedback crosses subscription');
      db.prepare('INSERT INTO scene_instruction_feedback VALUES (?, ?, ?, ?, ?)').run(row.instruction_id, row.inbox_item_id, row.prompt_revision_id, row.instruction, row.created_at);
    }
    for (const row of requests) {
      requireCard(row.inbox_item_id);
      db.prepare('INSERT INTO scene_presentation_requests VALUES (?, ?, ?, ?)').run(row.idempotency_key, row.inbox_item_id, JSON.stringify(row.request_json), JSON.stringify(row.response_json));
    }
    for (const row of reviews) {
      requireCard(row.inbox_item_id);
      db.prepare('INSERT INTO scene_presentation_reviews VALUES (?, ?)').run(row.inbox_item_id, row.checked_at);
    }
    for (const row of changes) {
      const card = cardMap.get(row.inbox_item_id);
      const workspace = card ? scopes.get(card.insight_id) : row.workspace_id;
      if (workspace !== row.workspace_id || !owners.has(workspace)) throw new Error('Presentation change crosses ownership');
      const previousWorkspace = changeWorkspaces.get(row.inbox_item_id);
      if (previousWorkspace && previousWorkspace !== workspace) throw new Error('Presentation change identity crosses workspaces');
      changeWorkspaces.set(row.inbox_item_id, workspace);
      // Deleted cards retain their change-log identity without inventing an outcome.
      if (!card && !deletedCards.has(JSON.stringify([workspace, row.inbox_item_id]))) throw new Error('Missing presentation has no deletion evidence');
      db.prepare('INSERT INTO scene_presentation_changes VALUES (?, ?, ?, ?, ?)').run(row.sequence, owners.get(workspace)!, workspace, row.inbox_item_id, row.deleted);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Outcome conversion broke foreign keys');
    db.exec('RELEASE scene_outcome_conversion');
    return { presentations: cards.map((card) => ({ inboxItemId: card.inbox_item_id, presentationId: card.inbox_item_id })),
      counts: { outcomes: insights.length, presentations: cards.length, decisions: decisions.length,
        instructions: instructions.length, requests: requests.length, reviews: reviews.length, changes: changes.length } };
  } catch (error) {
    db.exec('ROLLBACK TO scene_outcome_conversion'); db.exec('RELEASE scene_outcome_conversion'); throw error;
  }
}
