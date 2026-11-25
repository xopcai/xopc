import { createHash } from 'node:crypto';

import { inferMemorySensitivity } from '../agent/memory/sensitivity.js';
import type { Config } from '../config/schema.js';
import { listKnowledgeItems } from '../knowledge-memory/index.js';
import type { AttentionThread } from '../personal-agent/proactivity/repository.js';
import { getPersonalAgent } from '../personal-agent/repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { TaskRepository } from '../tasks/task-repository.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';
import { resolveUserContextSessionAccess } from '../user-context/access-policy.js';
import type { ScoutReadOnlyContext } from './triage-service.js';
import type { CoalescedSignal } from './types.js';

export interface AttentionLiveContextItem {
  ref: string;
  kind: 'task_state' | 'project_state' | 'proactive_signal' | 'knowledge_memory';
  excerpt: string;
  updatedAt: number;
}

const MAX_SIGNAL_CONTEXT_ITEMS = 8;
const MAX_ATTENTION_CONTEXT_ITEMS = 8;

function isSafeExcerpt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const sensitivity = inferMemorySensitivity(trimmed);
  return sensitivity !== 'secret' && sensitivity !== 'regulated';
}

function extractKeywords(text: string): string[] {
  const tokens = text
    .toLocaleLowerCase()
    .split(/[\s,，。！？!?：:；;()（）[\]【】/\\\-_·"“”'‘’]+/u)
    .map(tok => tok.trim())
    .filter(tok => tok.length >= 2);
  return [...new Set(tokens)].slice(0, 12);
}

function keywordOverlapScore(keywords: readonly string[], candidate: string): number {
  if (!keywords.length || !candidate) return 0;
  const lower = candidate.toLocaleLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) hits += 1;
  }
  return hits;
}

export function readTaskSnapshot(taskId: string): { excerpt: string; updatedAt: number } | null {
  const task = new TaskRepository().get(taskId);
  if (!task) return null;
  const runs = new TaskRunRepository();
  const waits = runs.listActiveWaits(task.id);
  const db = getSqliteDatabase();
  const latestRun = db
    .prepare('SELECT run_id FROM task_runs WHERE task_id = ? AND parent_run_id IS NULL ORDER BY queued_at DESC, rowid DESC LIMIT 1')
    .get(task.id) as { run_id?: string } | undefined;
  const receipt = latestRun?.run_id ? runs.getReceipt(latestRun.run_id) : undefined;

  const parts = [
    `Task "${task.title}" (phase=${task.phase}, priority=${task.priority}${task.resolution ? `, resolution=${task.resolution}` : ''})`,
  ];
  if (task.dueAt) {
    parts.push(`dueAt=${new Date(task.dueAt).toISOString()}`);
  }
  if (waits.length > 0) {
    const waitSummaries = waits.slice(0, 3).map(wait => {
      const q = typeof wait.condition.question === 'string' && wait.condition.question.trim()
        ? wait.condition.question.trim()
        : wait.reason;
      return `[${wait.kind}] ${q.slice(0, 160)}`;
    });
    parts.push(`activeWaits: ${waitSummaries.join('; ')}`);
  }
  if (receipt?.summary) {
    parts.push(`latestReceipt(${receipt.status}): ${receipt.summary.slice(0, 320)}`);
  }
  const excerpt = parts.join(' | ').slice(0, 700);
  if (!isSafeExcerpt(excerpt)) return null;
  return { excerpt, updatedAt: task.updatedAt };
}

export function readProjectSnapshot(projectId: string): { excerpt: string; updatedAt: number } | null {
  const db = getSqliteDatabase();
  const project = db.prepare(`
    SELECT project_id, name, status, health, outcome, target_at, updated_at
    FROM projects
    WHERE project_id = ?
    LIMIT 1
  `).get(projectId) as {
    project_id: string;
    name: string;
    status: string;
    health: string;
    outcome: string | null;
    target_at: number | null;
    updated_at: number;
  } | undefined;
  if (!project) return null;

  const openTasks = db.prepare(`
    SELECT task_id, title, phase, priority, due_at, updated_at
    FROM tasks
    WHERE project_id = ? AND phase != 'closed'
    ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END ASC, updated_at DESC
    LIMIT 5
  `).all(projectId) as Array<{
    task_id: string;
    title: string;
    phase: string;
    priority: string;
    due_at: number | null;
    updated_at: number;
  }>;

  const parts = [
    `Project "${project.name}" (status=${project.status}, health=${project.health})`,
  ];
  if (project.outcome) parts.push(`outcome: ${project.outcome.slice(0, 180)}`);
  if (project.target_at) parts.push(`targetAt=${new Date(project.target_at).toISOString()}`);
  if (openTasks.length > 0) {
    const taskLines = openTasks.map(t => `${t.title.slice(0, 80)} [${t.phase}/${t.priority}]`);
    parts.push(`openTasks(${openTasks.length}): ${taskLines.join('; ')}`);
  }
  const latestUpdate = Math.max(project.updated_at, ...openTasks.map(t => t.updated_at));
  const excerpt = parts.join(' | ').slice(0, 750);
  if (!isSafeExcerpt(excerpt)) return null;
  return { excerpt, updatedAt: latestUpdate };
}

/**
 * Bounded, strictly read-only context probe for ProactiveHub Gate 3 Scout.
 * Supplies live authorized Task/Project state, matching user attention threads,
 * and recent signal history so Scout can cross-check real progress without write access.
 */
export function collectSignalReadOnlyContext(params: {
  ownerId: string;
  signal: CoalescedSignal;
  config: Config;
  now?: number;
}): ScoutReadOnlyContext[] {
  const { ownerId, signal, config } = params;
  if (!config.userContext.enabled || config.userContext.userModel.processingPolicy === 'local_only') {
    return [];
  }

  const personal = getPersonalAgent(ownerId);
  if (personal && !resolveUserContextSessionAccess(config, personal.conversationId).userModel) {
    return [];
  }

  const db = getSqliteDatabase();
  const results: ScoutReadOnlyContext[] = [];
  const seenRefs = new Set<string>();
  const push = (item: ScoutReadOnlyContext) => {
    if (results.length >= MAX_SIGNAL_CONTEXT_ITEMS || seenRefs.has(item.ref) || !isSafeExcerpt(item.excerpt)) return;
    seenRefs.add(item.ref);
    results.push({ ...item, excerpt: item.excerpt.slice(0, 700) });
  };

  const payload = signal.payload ?? {};
  const projectId = (signal.subjectKind === 'project' ? signal.subjectId : undefined)
    ?? (typeof payload.projectId === 'string' && payload.projectId.trim() ? payload.projectId.trim() : undefined);
  const taskId = (signal.subjectKind === 'task' ? signal.subjectId : undefined)
    ?? (typeof payload.taskId === 'string' && payload.taskId.trim() ? payload.taskId.trim() : undefined);

  if (taskId) {
    const snap = readTaskSnapshot(taskId);
    if (snap) {
      push({ ref: `task:${taskId}`, kind: 'authorized_excerpt', excerpt: snap.excerpt });
    }
  }

  if (projectId) {
    const snap = readProjectSnapshot(projectId);
    if (snap) {
      push({ ref: `project:${projectId}`, kind: 'authorized_excerpt', excerpt: snap.excerpt });
    }
  }

  // Surface active user-explicit attention threads relevant to this signal so Scout respects user priorities.
  const signalText = [
    signal.eventType,
    signal.source,
    typeof payload.title === 'string' ? payload.title : '',
    typeof payload.subject === 'string' ? payload.subject : '',
    typeof payload.summary === 'string' ? payload.summary : '',
    typeof payload.repositoryName === 'string' ? payload.repositoryName : '',
    typeof payload.folderName === 'string' ? payload.folderName : '',
  ].join(' ');
  const keywords = extractKeywords(signalText);

  const activeThreads = db.prepare(`
    SELECT id, subject, summary, authority, follow_up_mode, task_id, project_id
    FROM personal_attention_threads
    WHERE owner_id = ? AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 20
  `).all(ownerId) as Array<{
    id: string;
    subject: string;
    summary: string;
    authority: string;
    follow_up_mode: string;
    task_id: string | null;
    project_id: string | null;
  }>;

  const rankedThreads = activeThreads
    .map(thread => {
      let score = 0;
      if (projectId && thread.project_id === projectId) score += 5;
      if (taskId && thread.task_id === taskId) score += 6;
      if (thread.authority === 'user_explicit') score += 1;
      score += keywordOverlapScore(keywords, `${thread.subject} ${thread.summary}`) * 2;
      return { thread, score };
    })
    .filter(entry => entry.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  for (const { thread } of rankedThreads) {
    push({
      ref: `attention:${thread.id}`,
      kind: 'attention_thread',
      excerpt: `Active user follow-up (${thread.authority}/${thread.follow_up_mode}): "${thread.subject}" — ${thread.summary.slice(0, 280)}`,
    });
  }

  // Provide recent history on the same coalesceKey so Scout detects genuine deltas rather than repeating prior alerts.
  const priorItems = db.prepare(`
    SELECT id, title, summary, state, updated_at
    FROM proactive_items
    WHERE owner_id = ? AND coalesce_key = ? AND state IN ('ready', 'delivered', 'acted')
    ORDER BY updated_at DESC
    LIMIT 2
  `).all(ownerId, signal.coalesceKey) as Array<{
    id: string;
    title: string;
    summary: string;
    state: string;
    updated_at: number;
  }>;
  for (const prior of priorItems) {
    push({
      ref: `proactive_prior:${prior.id}`,
      kind: 'authorized_excerpt',
      excerpt: `Previous alert (${prior.state}, ${new Date(prior.updated_at).toISOString()}): ${prior.title} — ${prior.summary.slice(0, 240)}`,
    });
  }

  return results;
}

/**
 * Bounded, strictly read-only live context probe for PersonalProactivityService recurring follow-ups.
 * Bridges the gap between passive transcript-only evaluation and real workspace/task/signal state.
 */
export function collectAttentionLiveContext(params: {
  ownerId: string;
  thread: AttentionThread;
  config: Config;
  now?: number;
}): AttentionLiveContextItem[] {
  const { ownerId, thread, config } = params;
  const now = params.now ?? Date.now();
  if (!config.userContext.enabled || config.userContext.userModel.processingPolicy === 'local_only') {
    return [];
  }

  const access = resolveUserContextSessionAccess(config, thread.conversation_id);
  if (!access.userModel) return [];

  const db = getSqliteDatabase();
  const items: AttentionLiveContextItem[] = [];
  const seen = new Set<string>();
  const push = (item: AttentionLiveContextItem) => {
    if (items.length >= MAX_ATTENTION_CONTEXT_ITEMS || seen.has(item.ref) || !isSafeExcerpt(item.excerpt)) return;
    seen.add(item.ref);
    items.push({ ...item, excerpt: item.excerpt.slice(0, 700) });
  };

  if (thread.task_id) {
    const snap = readTaskSnapshot(thread.task_id);
    if (snap) {
      push({ ref: `task:${thread.task_id}`, kind: 'task_state', excerpt: snap.excerpt, updatedAt: snap.updatedAt });
    }
  }

  if (thread.project_id) {
    const snap = readProjectSnapshot(thread.project_id);
    if (snap) {
      push({ ref: `project:${thread.project_id}`, kind: 'project_state', excerpt: snap.excerpt, updatedAt: snap.updatedAt });
    }
  }

  // Pull recent authorized external/local proactive signals related to this follow-up topic (last 7 days).
  const keywords = extractKeywords(`${thread.subject} ${thread.summary}`);
  const recentCutoff = now - 7 * 86_400_000;
  const recentSignals = db.prepare(`
    SELECT id, category, title, summary, provenance_json, state, updated_at
    FROM proactive_items
    WHERE owner_id = ?
      AND category != 'pulse_digest'
      AND state IN ('ready', 'delivered', 'buffered_digest', 'acted')
      AND updated_at >= ?
    ORDER BY updated_at DESC
    LIMIT 25
  `).all(ownerId, recentCutoff) as Array<{
    id: string;
    category: string;
    title: string;
    summary: string;
    provenance_json: string;
    state: string;
    updated_at: number;
  }>;

  const matchedSignals = recentSignals
    .map(row => {
      let matchedProjectId: string | undefined;
      try {
        const parsed = JSON.parse(row.provenance_json) as { matchedProjectId?: string; matchedTaskId?: string };
        matchedProjectId = parsed.matchedProjectId;
        if (thread.task_id && parsed.matchedTaskId === thread.task_id) {
          return { row, score: 10 };
        }
      } catch {
        // Ignore malformed provenance JSON.
      }
      let score = 0;
      if (thread.project_id && matchedProjectId === thread.project_id) score += 5;
      score += keywordOverlapScore(keywords, `${row.title} ${row.summary}`) * 2;
      return { row, score };
    })
    .filter(entry => entry.score >= 2)
    .sort((a, b) => b.score - a.score || b.row.updated_at - a.row.updated_at)
    .slice(0, 3);

  for (const { row } of matchedSignals) {
    push({
      ref: `signal:${row.id}`,
      kind: 'proactive_signal',
      excerpt: `[${row.category}/${row.state}] ${row.title} — ${row.summary.slice(0, 300)}`,
      updatedAt: row.updated_at,
    });
  }

  // Pull bounded normal-sensitivity knowledge memory scoped to the project or strongly matching the subject.
  if (config.userContext.knowledgeMemory.enabled && access.knowledge) {
    const memoryItems = listKnowledgeItems({
      recordClass: 'memory',
      statuses: ['active'],
      limit: 20,
    })
      .filter(item => item.sensitivity === 'normal')
      .map(item => {
        let score = 0;
        if (thread.project_id && item.scope.type === 'project' && item.scope.id === thread.project_id) {
          score += 4;
        } else if (item.scope.type === 'project' && item.scope.id !== thread.project_id) {
          return { item, score: 0 };
        }
        score += keywordOverlapScore(keywords, item.content) * 2;
        return { item, score };
      })
      .filter(entry => entry.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const { item } of memoryItems) {
      push({
        ref: `knowledge:${item.id}`,
        kind: 'knowledge_memory',
        excerpt: item.content.slice(0, 420),
        updatedAt: item.updatedAt,
      });
    }
  }

  return items;
}

export function liveContextFingerprint(items: readonly AttentionLiveContextItem[]): string {
  if (!items.length) return '';
  return createHash('sha256')
    .update(JSON.stringify(items.map(item => ({ ref: item.ref, excerpt: item.excerpt }))))
    .digest('hex');
}
