import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { TaskWorkspaceDestinationSchema, type Task, type TaskWorkspaceDestination } from '@xopcai/gateway-contract';

import { resolveAgentWorkspaceDir } from '../agent/agent-scope.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

type WorkspaceTask = Pick<Task, 'id' | 'contract' | 'projectId' | 'delegateAgentId'>;
type WorkspaceObservation = { workspaceId: string; relativePath: string; root?: string; fingerprint?: string; status: 'present' | 'missing' | 'unavailable' };
export type TaskWorkspaceFile = WorkspaceObservation & { verified: boolean };

function workspaceRoot(task: WorkspaceTask, destination: TaskWorkspaceDestination): string | undefined {
  const db = getSqliteDatabase();
  if (task.projectId && destination.workspaceId === `project:${task.projectId}`) {
    return (db.prepare('SELECT workspace_root FROM projects WHERE project_id = ?').get(task.projectId)?.workspace_root as string | null) ?? undefined;
  }
  const origin = db.prepare('SELECT session.agent_id FROM task_origin_links origin JOIN sessions session USING (conversation_id) WHERE origin.task_id = ?')
    .get(task.id)?.agent_id;
  const agent = typeof origin === 'string' ? origin : task.delegateAgentId;
  if (agent && destination.workspaceId === `agent:${agent}` &&
    db.prepare('SELECT 1 FROM agents WHERE id = ? AND deleted_at IS NULL').get(agent)) {
    return resolveAgentWorkspaceDir(agent);
  }
  return undefined;
}

export function inspectTaskWorkspace(task: WorkspaceTask): WorkspaceObservation[] {
  return (task.contract?.outputDestinations ?? [])
    .filter(destination => destination.kind === 'workspace_file' || destination.kind === 'unresolved_workspace_file')
    .map(destination => {
      const target = TaskWorkspaceDestinationSchema.safeParse(destination);
      const key = { workspaceId: String(destination.workspaceId ?? ''), relativePath: String(destination.relativePath ?? '') };
      if (!target.success) return { ...key, status: 'unavailable' };
      const rootPath = workspaceRoot(task, target.data);
      if (!rootPath || !isAbsolute(rootPath) ||
        (target.data.expectedRoot && resolve(rootPath) !== target.data.expectedRoot)) return { ...key, status: 'unavailable' };
      let root: string | undefined;
      try {
        const canonical = realpathSync(rootPath);
        if (!lstatSync(canonical).isDirectory()) return { ...key, status: 'unavailable' };
        root = createHash('sha256').update(canonical).digest('hex');
        const candidate = resolve(canonical, target.data.relativePath);
        if (realpathSync(candidate) !== candidate) return { ...key, root, status: 'unavailable' };
        const info = lstatSync(candidate, { bigint: true });
        if (!info.isFile()) return { ...key, root, status: 'unavailable' };
        const fingerprint = [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
        return { ...key, root, fingerprint, status: 'present' };
      } catch (error) {
        return { ...key, root, status: root && (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable' };
      }
    });
}

export function verifyTaskWorkspace(task: WorkspaceTask, baseline: unknown): TaskWorkspaceFile[] {
  const previous = Array.isArray(baseline) ? baseline as WorkspaceObservation[] : [];
  return inspectTaskWorkspace(task).map(current => {
    const before = previous.find(item => item.workspaceId === current.workspaceId && item.relativePath === current.relativePath);
    return { ...current, verified: current.status === 'present' && before !== undefined && before.root === current.root
      && (before.status === 'missing' || (before.status === 'present' && before.fingerprint !== current.fingerprint)) };
  });
}

export function taskWorkspaceStillVerified(task: WorkspaceTask, observed: TaskWorkspaceFile[]): boolean {
  return inspectTaskWorkspace(task).every(current => current.status === 'present' && observed.some(result =>
    result.verified && result.workspaceId === current.workspaceId && result.relativePath === current.relativePath
      && result.root === current.root && result.fingerprint === current.fingerprint));
}
