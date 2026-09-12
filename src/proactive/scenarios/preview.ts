import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { ContextProviderRegistry } from '../execution/context.js';
import { parseAnalysisResult } from '../execution/insight.js';
import type { ProactiveAgentExecutor } from '../execution/types.js';
import { subscriptionSettings, ProactiveConflict } from '../policy/service.js';
import { requireSubscription } from './control.js';
import { composeScenarioPrompt } from './prompt-composer.js';
import { getPromptRevision, getScenario } from './repository.js';

export async function previewSubscription(workspace: string, id: string, executor: ProactiveAgentExecutor, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const sub = requireSubscription(id, workspace);
  const settings = subscriptionSettings(id);
  const scenario = getScenario(sub.scenarioKey)!;
  const now = new Date();
  const previewId = randomUUID();
  runSqliteWriteTransaction((db) => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM proactive_preview_runs WHERE subscription_id = ? AND created_at >= ?').get(id, new Date(now.getTime() - 86400000).toISOString()) as { n: number };
    if (count.n >= 5 || db.prepare('SELECT 1 FROM proactive_preview_runs WHERE subscription_id = ? AND created_at >= ?').get(id, new Date(now.getTime() - 300000).toISOString())) throw new ProactiveConflict('Preview is limited to once every five minutes and five times per day');
    db.prepare('INSERT INTO proactive_preview_runs(id, subscription_id, created_at, status) VALUES (?, ?, ?, ?)').run(previewId, id, now.toISOString(), 'running');
  });
  try {
    const db = getSqliteDatabase();
    const eventIds = (db.prepare(`SELECT event_id FROM proactive_events WHERE workspace_id = ? AND (? IS NULL OR project_id = ?)
      AND type IN (${scenario.eventTypes.map(() => '?').join(',')}) ORDER BY occurred_at DESC LIMIT 50`)
      .all(workspace, sub.scopeKind === 'project' ? sub.scopeId : null, sub.scopeKind === 'project' ? sub.scopeId : null, ...scenario.eventTypes) as Array<{ event_id: string }>).map((row) => row.event_id);
    const registry = new ContextProviderRegistry();
    const input = { batchId: previewId, subscriptionId: id, eventIds };
    const context = await registry.collect(scenario, input);
    if (sub.scopeKind === 'project' && !context.evidenceIds.length) {
      const project = db.prepare('SELECT project_id, name, description FROM projects WHERE project_id = ?').get(sub.scopeId) as Record<string, unknown> | undefined;
      if (project) {
        const tasks = db.prepare("SELECT task_id, title, phase, due_at FROM tasks WHERE project_id = ? AND phase <> 'closed' LIMIT 30").all(sub.scopeId) as Array<{ task_id: string }>;
        context.content.project_state = { project: { ...project, evidenceId: `project:${sub.scopeId}` }, tasks: tasks.map((task) => ({ ...task, evidenceId: `task:${task.task_id}` })) };
        context.evidenceIds = [`project:${sub.scopeId}`, ...tasks.map((task) => `task:${task.task_id}`)];
      }
    }
    const revision = sub.activePromptRevisionId ? getPromptRevision(sub.activePromptRevisionId) ?? undefined : undefined;
    const prompt = composeScenarioPrompt({ scenario, revision, runtimeContext: 'This is a read-only preview. Do not execute any action or send notifications.' });
    const result = !context.evidenceIds.length ? { result: 'no_insight' as const, reason: 'source_unavailable' } : parseAnalysisResult((await executor.execute({ systemPrompt: prompt.platformSafety, userPrompt: prompt.text, authorizedContext: context.content, signal })).text, new Set(context.evidenceIds));
    signal?.throwIfAborted();
    if (subscriptionSettings(id).revision !== settings.revision) throw new ProactiveConflict('Subscription changed during preview');
    const latest = await registry.collect(scenario, input);
    if (sub.scopeKind === 'project' && !db.prepare('SELECT 1 FROM projects WHERE project_id = ?').get(sub.scopeId)) throw new ProactiveConflict('Project was removed during preview');
    if (eventIds.length && context.evidenceIds.some((evidenceId) => !latest.evidenceIds.includes(evidenceId))) throw new ProactiveConflict('Source permission changed during preview');
    db.prepare("UPDATE proactive_preview_runs SET status = 'completed', completed_at = ? WHERE id = ?").run(new Date().toISOString(), previewId);
    return { previewId, result, sourceCount: context.evidenceIds.length, createdAt: now.toISOString() };
  } catch (error) {
    getSqliteDatabase().prepare("UPDATE proactive_preview_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?").run(new Date().toISOString(), error instanceof Error ? error.message.slice(0, 500) : 'Preview failed', previewId);
    throw error;
  }
}
