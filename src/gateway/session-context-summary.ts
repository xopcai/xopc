import { realpath, stat } from 'node:fs/promises';

import type { SessionContextSummary } from '@xopcai/gateway-contract';

import { isSessionSourceBinding } from '../agent/source-context/types.js';
import type { Config } from '../config/schema.js';
import { getExecutionEnvironmentForSession } from '../execution-environments/subject.js';
import { runExec } from '../infra/exec.js';
import { ProjectStore } from '../projects/project-store.js';
import { effectiveWorkspacePathForSession } from '../session/session-workspace.js';
import { getSessionConfig } from '../storage/sqlite/config-repository.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { TaskConversationRepository } from '../tasks/task-conversation-repository.js';
import { TaskRepository } from '../tasks/task-repository.js';
import { createLogger } from '../utils/logger.js';
import { hasGatewayScope, type GatewayScope } from './security/gateway-scopes.js';

const log = createLogger('SessionContextSummary');
const SOURCE_LIMIT = 20;

async function readEnvironment(config: Config, sessionKey: string, projectId?: string): Promise<SessionContextSummary['environment']> {
  const bound = getExecutionEnvironmentForSession(sessionKey);
  const project = projectId ? new ProjectStore().get(projectId) : undefined;
  const rootPath = bound?.rootPath
    ?? effectiveWorkspacePathForSession(config, sessionKey, getSessionConfig(sessionKey), project);
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
  sessionKey: string,
  scopes: readonly GatewayScope[],
): Promise<SessionContextSummary | null> {
  const metadata = getSessionMetadata(sessionKey);
  if (!metadata) return null;
  const summary: SessionContextSummary = {
    sessionKey, observedAt: new Date().toISOString(), work: {},
    sources: [], sourcesHasMore: false, unavailableSections: [],
  };
  const canReadWorkspace = hasGatewayScope(scopes, 'workspace.read');
  const canReadTasks = hasGatewayScope(scopes, 'tasks.read');
  const unavailable = (section: SessionContextSummary['unavailableSections'][number], err?: unknown) => {
    if (!summary.unavailableSections.includes(section)) summary.unavailableSections.push(section);
    if (err) log.warn({ err, sessionKey, section }, 'Context summary section unavailable');
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
      const taskId = new TaskConversationRepository().resolveActiveExecutionSession(sessionKey)?.taskId;
      const task = taskId ? new TaskRepository().get(taskId) : undefined;
      if (task) summary.work.task = { id: task.id, title: task.title.slice(0, 240), phase: task.phase };
      else if (taskId) unavailable('work');
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
          ...(row.from_session ? [{ kind: 'session' as const, version: source?.version }] : []),
          ...(row.from_task ? [{ kind: 'task' as const }] : []),
        ],
      }));
    } catch (err) { unavailable('sources', err); }
    try {
      summary.environment = await readEnvironment(config, sessionKey, metadata.projectId);
    } catch (err) { unavailable('environment', err); }
  } else {
    unavailable('sources');
    unavailable('environment');
  }
  summary.observedAt = new Date().toISOString();
  return summary;
}
