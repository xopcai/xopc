import { SessionEnvironmentService } from '../../execution-environments/session-environment-service.js';
import { resolveGitCommit } from '../../execution-environments/git.js';
import type { ProjectService } from '../../projects/project-service.js';
import type { SessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { claimSessionPreparation, finishSessionPreparation, pendingSessionPreparations, getSessionPreparation } from '../../storage/sqlite/session-creation-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Gateway:SessionPreparation');

export interface SessionPreparationWorkerService {
  projects: Pick<ProjectService, 'get'>;
  drainSessionInputs(conversationId: string): Promise<unknown>;
  getSessionInputState(conversationId: string): SessionInputState;
  emit(type: string, payload: unknown): void;
}

export class SessionPreparationWorker {
  private timer?: ReturnType<typeof setInterval>;
  private readonly active = new Map<string, Promise<void>>();
  private cleaning = false;
  private cleanupTask?: Promise<void>;
  private readonly environments = new SessionEnvironmentService();
  constructor(private readonly service: SessionPreparationWorkerService) {}

  start(): void {
    if (this.timer) return;
    const scan = () => {
      for (const id of pendingSessionPreparations()) this.wake(id);
      this.cleanupTask ??= this.cleanup()
        .catch(err => log.error({ err }, 'Session reservation cleanup scan failed'))
        .finally(() => { this.cleanupTask = undefined; });
    };
    scan();
    this.timer = setInterval(scan, 5_000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer); this.timer = undefined;
    await Promise.allSettled(this.active.values());
    await this.cleanupTask;
  }

  wake(conversationId: string): void {
    if (this.active.has(conversationId)) return;
    const work = this.prepare(conversationId).catch(err => {
      log.error({ err, conversationId, phase: 'prepare' }, 'Session preparation failed');
    }).finally(() => this.active.delete(conversationId));
    this.active.set(conversationId, work);
  }

  private async cleanup(): Promise<void> {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      const pending = getSqliteDatabase().prepare('SELECT * FROM session_preparation_cleanup WHERE not_before<=?')
        .all(Date.now()) as Array<{ environment_id: string; conversation_id: string }>;
      for (const row of pending) {
        if (this.active.has(row.conversation_id)) continue;
        try {
          if (await this.environments.removeUnboundReservation(row.environment_id)) {
            getSqliteDatabase().prepare('DELETE FROM session_preparation_cleanup WHERE environment_id=?').run(row.environment_id);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          getSqliteDatabase().prepare('UPDATE session_preparation_cleanup SET last_error=?,not_before=? WHERE environment_id=?')
            .run(message, Date.now() + 60_000, row.environment_id);
        }
      }
    } finally { this.cleaning = false; }
  }

  private async prepare(conversationId: string): Promise<void> {
    const operation = claimSessionPreparation(conversationId);
    if (!operation) return;
    const heartbeat = setInterval(() => {
      getSqliteDatabase().prepare(`UPDATE session_preparations SET lease_until=?
        WHERE operation_id=? AND revision=? AND state='preparing'`)
        .run(Date.now() + 60_000, operation.operationId, operation.revision);
    }, 15_000);
    heartbeat.unref();
    try {
      const project = operation.creation.projectId ? this.service.projects.get(operation.creation.projectId) : null;
      if (!project?.workspaceRoot || !operation.creation.execution) throw new Error('Project workspace is unavailable');
      let baseRef = operation.baseCommit ?? undefined;
      if (operation.creation.execution.mode === 'managed_worktree' && !baseRef) {
        baseRef = await resolveGitCommit(project.workspaceRoot, operation.creation.execution.baseRef ?? 'HEAD');
        const changed = getSqliteDatabase().prepare('UPDATE session_preparations SET base_commit=? WHERE operation_id=? AND revision=?')
          .run(baseRef, operation.operationId, operation.revision).changes;
        if (!changed) return;
      }
      if (!getSessionMetadata(conversationId)) return;
      await this.environments.attach({ conversationId, project, mode: operation.creation.execution.mode,
        baseRef, environmentId: operation.environmentId, assertCurrent: () => {
          const current = getSessionPreparation(conversationId);
          if (!current || current.operationId !== operation.operationId || current.revision !== operation.revision || current.state !== 'preparing'
            || !getSessionMetadata(conversationId)) throw new Error('Session preparation ownership changed');
        } });
      const ready = runSqliteWriteTransaction(() => {
        if (!getSessionMetadata(conversationId)) return false;
        return finishSessionPreparation(operation);
      });
      if (ready) void this.service.drainSessionInputs(conversationId).catch(err => {
        log.error({ err, conversationId }, 'Prepared session input drain failed');
      });
    } catch (error) {
      finishSessionPreparation(operation, error instanceof Error ? error.message : String(error));
      log.warn({ err: error, conversationId, operationId: operation.operationId }, 'Session environment preparation failed');
    } finally {
      clearInterval(heartbeat);
      const preparation = getSessionPreparation(conversationId);
      if (preparation) this.service.emit('session.input-state', {
        ...this.service.getSessionInputState(conversationId), preparation,
      });
    }
  }
}
