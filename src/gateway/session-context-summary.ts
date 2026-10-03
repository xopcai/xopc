import { realpath, stat } from 'node:fs/promises';

import type { SessionContextSummary } from '@xopcai/gateway-contract';

import { isSessionSourceBinding } from '../agent/source-context/types.js';
import type { Config } from '../config/schema.js';
import { getExecutionEnvironmentForSession } from '../execution-environments/subject.js';
import { runExec } from '../infra/exec.js';
import { ProjectStore } from '../projects/project-store.js';
import { effectiveWorkspacePathForSession } from '../session/session-workspace.js';
import { getSessionConfig } from '../storage/sqlite/config-repository.js';
import { getCurrentTranscriptId, getSessionMetadata } from '../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { TaskConversationRepository } from '../tasks/task-conversation-repository.js';
import { TaskRepository } from '../tasks/task-repository.js';
import { TaskOriginRepository } from '../tasks/task-origin-repository.js';
import { TaskCollaborationRepository } from '../tasks/task-collaboration-repository.js';
import { createLogger } from '../utils/logger.js';
import { hasGatewayScope, type GatewayScope } from './security/gateway-scopes.js';

const log = createLogger('SessionContextSummary');
const SOURCE_LIMIT = 20;
const RECENT_SOURCE_KINDS = new Set(['note', 'file', 'session', 'browser_tab', 'mcp_resource', 'browser_page', 'app_context']);

function parseRecentSources(value: string | null): SessionContextSummary['sources'] {
  if (!value) return [];
  let rows: unknown;
  try { rows = JSON.parse(value); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, SOURCE_LIMIT + 1).flatMap((value): SessionContextSummary['sources'] => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    if (!RECENT_SOURCE_KINDS.has(String(row.kind)) || typeof row.sourceId !== 'string' || !row.sourceId) return [];
    return [{
      kind: row.kind as SessionContextSummary['sources'][number]['kind'], id: row.sourceId,
      ...(typeof row.title === 'string' ? { title: row.title.slice(0, 240) } : {}),
      ...(row.fileKind === 'file' || row.fileKind === 'directory' ? { fileKind: row.fileKind } : {}),
      origins: [{ kind: 'recent' }],
    }];
  });
}

function parseRecentAttachments(value: string | null): SessionContextSummary['sources'] {
  if (!value) return [];
  let rows: unknown;
  try { rows = JSON.parse(value); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, SOURCE_LIMIT + 1).flatMap((value): SessionContextSummary['sources'] => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const id = typeof row.uri === 'string' ? row.uri : typeof row.id === 'string' ? row.id : undefined;
    if (!id || !id.startsWith('media://')) return [];
    return [{ kind: 'attachment', id,
      ...(typeof row.name === 'string' ? { title: row.name.slice(0, 240) } : {}),
      origins: [{ kind: 'recent' }],
    }];
  });
}

/** Reads only reference metadata from the latest visible user turn and current queued input. */
function readRecentSources(conversationId: string): SessionContextSummary['sources'] {
  const transcriptId = getCurrentTranscriptId(conversationId);
  if (!transcriptId) return [];
  const db = getSqliteDatabase();
  const transcript = db.prepare(`SELECT
      (SELECT json_group_array(json_object(
        'kind', json_extract(value, '$.kind'), 'sourceId', json_extract(value, '$.sourceId'),
        'title', json_extract(value, '$.title'), 'fileKind', json_extract(value, '$.fileKind')
      )) FROM json_each(json_extract(entry.payload_json, '$.metadata.sourceContexts'))
        WHERE CAST(key AS INTEGER) < ?) AS refs,
      (SELECT json_group_array(json_object(
        'uri', json_extract(value, '$.uri'), 'name', json_extract(value, '$.name')
      )) FROM json_each(json_extract(entry.payload_json, '$.media'))
        WHERE CAST(key AS INTEGER) < ?) AS attachments
    FROM transcript_entries entry
    WHERE transcript_id = ? AND entry_kind = 'message' AND role = 'user'
      AND json_extract(payload_json, '$.metadata.hiddenFromClient') IS NOT 1
    ORDER BY seq DESC LIMIT 1`).get(SOURCE_LIMIT + 1, SOURCE_LIMIT + 1, transcriptId) as { refs: string | null; attachments: string | null } | undefined;
  const pending = db.prepare(`SELECT
      (SELECT json_group_array(json_object(
        'kind', json_extract(value, '$.kind'), 'sourceId', json_extract(value, '$.sourceId'),
        'title', json_extract(value, '$.title'), 'fileKind', json_extract(value, '$.fileKind')
      )) FROM json_each(input.context_refs_json)
        WHERE CAST(key AS INTEGER) < ?) AS refs,
      (SELECT json_group_array(json_object(
        'uri', json_extract(value, '$.uri'), 'name', json_extract(value, '$.name')
      )) FROM json_each(input.attachments_json)
        WHERE CAST(key AS INTEGER) < ?) AS attachments
    FROM session_inputs input WHERE conversation_id = ? AND expected_transcript_id = ?
      AND kind = 'message' AND status IN ('queued', 'running', 'injecting', 'interrupted')
      AND json_extract(origin_json, '$.type') != 'system'
    ORDER BY created_at_ms DESC LIMIT 1`).get(SOURCE_LIMIT + 1, SOURCE_LIMIT + 1, conversationId, transcriptId) as { refs: string | null; attachments: string | null } | undefined;
  const latest = pending ?? transcript;
  return latest ? [...parseRecentSources(latest.refs), ...parseRecentAttachments(latest.attachments)] : [];
}

async function readEnvironment(config: Config, conversationId: string, projectId?: string): Promise<SessionContextSummary['environment']> {
  const bound = getExecutionEnvironmentForSession(conversationId);
  const project = projectId ? new ProjectStore().get(projectId) : undefined;
  const rootPath = bound?.rootPath
    ?? effectiveWorkspacePathForSession(config, conversationId, getSessionConfig(conversationId), project);
  const available = (!bound || bound.status === 'ready')
    && await stat(rootPath).then((info) => info.isDirectory(), () => false);
  const environment: NonNullable<SessionContextSummary['environment']> = {
    kind: bound?.kind ?? 'local_checkout', rootPath, available,
  };
  if (!available) return environment;
  // No status scan, hooks, shell interpolation, or repository writes on this read path.
  const git = (args: string[]) => runExec('git', args, {
    cwd: rootPath, timeoutMs: 2_000, maxBuffer: 16_384,
  }).then((result) => result.stdout.trim());
  const [branch, head] = await Promise.allSettled([
    git(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    git(['rev-parse', '--verify', 'HEAD^{commit}']),
  ]);
  if (branch.status === 'fulfilled' && branch.value) environment.branch = branch.value;
  if (head.status === 'fulfilled' && head.value) {
    environment.headSha = head.value;
    environment.detached = branch.status === 'rejected' && branch.reason?.code === 1;
  }
  if (bound?.kind === 'managed_worktree') {
    const repositoryRoot = await git(['rev-parse', '--show-toplevel']).catch(() => undefined);
    environment.available = Boolean(environment.headSha && repositoryRoot
      && repositoryRoot === await realpath(rootPath));
    if (!environment.available) {
      delete environment.branch;
      delete environment.headSha;
      delete environment.detached;
    }
  }
  return environment;
}

/** A bounded metadata-only query. It never prepares Note context or starts an agent. */
export async function getSessionContextSummary(
  config: Config,
  conversationId: string,
  scopes: readonly GatewayScope[],
): Promise<SessionContextSummary | null> {
  const metadata = getSessionMetadata(conversationId);
  if (!metadata) return null;
  const summary: SessionContextSummary = {
    conversationId, observedAt: new Date().toISOString(), work: {},
    sources: [], sourcesHasMore: false, unavailableSections: [],
  };
  const canReadWorkspace = hasGatewayScope(scopes, 'workspace.read');
  const canReadTasks = hasGatewayScope(scopes, 'tasks.read');
  const unavailable = (section: SessionContextSummary['unavailableSections'][number], err?: unknown) => {
    if (!summary.unavailableSections.includes(section)) summary.unavailableSections.push(section);
    if (err) log.warn({ err, conversationId, section }, 'Context summary section unavailable');
  };

  if (canReadWorkspace) {
    try {
      const project = metadata.projectId ? new ProjectStore().get(metadata.projectId) : undefined;
      if (project) summary.work.project = { id: project.id, title: project.name.slice(0, 240) };
      else if (metadata.projectId) unavailable('work');
    } catch (err) { unavailable('work', err); }
  } else unavailable('work');

  if (canReadTasks) {
    try {
      const taskId = new TaskConversationRepository().resolveActiveExecutionSession(conversationId)?.taskId;
      const task = taskId ? new TaskRepository().get(taskId) : undefined;
      if (task) summary.work.task = { id: task.id, title: task.title.slice(0, 240), phase: task.phase };
      else if (taskId) unavailable('work');
      const delegated = new TaskOriginRepository().list(conversationId, 20);
      const board = new TaskCollaborationRepository();
      summary.work.delegatedTasks = delegated.items.map((item) => {
        const latest = board.latest(item.id);
        return { ...item, title: item.title.slice(0, 240),
          ...(latest ? { latestUpdate: { kind: latest.kind, body: latest.body.slice(0, 400),
            createdAt: latest.createdAt } } : {}) };
      });
      summary.work.delegatedTaskCount = delegated.total;
    } catch (err) { unavailable('work', err); }
  } else unavailable('work');

  if (canReadWorkspace) {
    try {
      const binding = metadata.customData?.sourceBinding;
      const source = isSessionSourceBinding(binding) ? binding : undefined;
      // Deduplicate task roles before joining. Read only titles, never Note bodies or stale edge titles.
      const rows = getSqliteDatabase().prepare(`
        WITH refs AS (
          SELECT ? AS note_id, 1 AS from_session, 0 AS from_task WHERE ? IS NOT NULL
          UNION ALL
          SELECT target_id, 0, 1 FROM context_edges
          WHERE owner_kind = 'task' AND owner_id = ? AND target_kind = 'note'
        ), grouped AS (
          SELECT note_id, MAX(from_session) AS from_session, MAX(from_task) AS from_task
          FROM refs GROUP BY note_id
        )
        SELECT g.*, n.note_id AS found_id, substr(n.title, 1, 240) AS title
        FROM grouped g LEFT JOIN notes n ON n.note_id = g.note_id AND n.status != 'trashed'
        ORDER BY g.from_session DESC, g.note_id LIMIT ?
      `).all(source?.sourceId ?? null, source?.sourceId ?? null, summary.work.task?.id ?? null, SOURCE_LIMIT + 1) as Array<{
        note_id: string; from_session: number; from_task: number; found_id: string | null; title: string | null;
      }>;
      summary.sourcesHasMore = rows.length > SOURCE_LIMIT;
      summary.sources = rows.slice(0, SOURCE_LIMIT).map((row) => ({
        kind: 'note', id: row.note_id,
        ...(row.found_id ? { title: row.title ?? undefined } : { unavailable: true }),
        origins: [
          ...(row.from_session ? [{ kind: 'session' as const }] : []),
          ...(row.from_task ? [{ kind: 'task' as const }] : []),
        ],
      }));
      const sources = new Map(summary.sources.map((source) => [`${source.kind}:${source.id}`, source]));
      const noteTitle = getSqliteDatabase().prepare(`SELECT substr(title, 1, 240) AS title
        FROM notes WHERE note_id = ? AND status != 'trashed'`);
      for (const recent of readRecentSources(conversationId)) {
        const key = `${recent.kind}:${recent.id}`;
        const existing = sources.get(key);
        if (existing) {
          if (!existing.origins.some((origin) => origin.kind === 'recent')) existing.origins.push({ kind: 'recent' });
          continue;
        }
        if (recent.kind === 'note') {
          const found = noteTitle.get(recent.id) as { title: string } | undefined;
          if (found) recent.title = found.title;
          else {
            delete recent.title;
            recent.unavailable = true;
          }
        }
        sources.set(key, recent);
      }
      summary.sourcesHasMore ||= sources.size > SOURCE_LIMIT;
      const priority = (item: SessionContextSummary['sources'][number]) =>
        item.origins.some((origin) => origin.kind === 'session') ? 0
          : item.origins.some((origin) => origin.kind === 'recent') ? 1 : 2;
      summary.sources = [...sources.values()].sort((a, b) => priority(a) - priority(b)).slice(0, SOURCE_LIMIT);
    } catch (err) { unavailable('sources', err); }
    try {
      summary.environment = await readEnvironment(config, conversationId, metadata.projectId);
    } catch (err) { unavailable('environment', err); }
  } else {
    unavailable('sources');
    unavailable('environment');
  }
  summary.observedAt = new Date().toISOString();
  return summary;
}
