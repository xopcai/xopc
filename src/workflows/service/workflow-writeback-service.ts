import { ProjectService } from '../../projects/project-service.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { createLogger } from '../../utils/logger.js';
import type { WorkflowRunMetadata } from '../domain/index.js';
import type { WorkflowRunStore } from '../store/run-store.js';

const log = createLogger('WorkflowWriteback');

export class WorkflowWritebackService {
  async apply(
    runStore: WorkflowRunStore,
    runId: string,
    status: 'succeeded' | 'failed' | 'cancelled',
  ): Promise<void> {
    try {
      const view = await runStore.readRunView(runId);
      if (!view) return;
      const summary = view.run.result?.summary?.trim()
        || view.run.error?.message?.trim()
        || `Workflow ${status}`;
      const taskRunId = view.run.metadata?.taskRunId;
      const linkedTaskRun = taskRunId ? new TaskRunRepository().get(taskRunId) : undefined;
      for (const target of view.run.metadata?.writebackPolicy?.targets ?? []) {
        if (target.kind === 'project') {
          if (target.id !== view.run.metadata?.projectId || !['record', 'suggest'].includes(target.mode)) continue;
          const projects = new ProjectService();
          const project = projects.get(target.id);
          if (!project) continue;
          const risks = view.run.result?.sections
            ?.filter((section) => section.kind === 'risks')
            .flatMap((section) => section.items.map((item) => item.title)) ?? [];
          projects.createUpdate(target.id, {
            health: project.health,
            summary: target.mode === 'suggest' ? `Workflow suggestion: ${summary}` : summary,
            risks,
            nextSteps: view.run.result?.followUps?.map((item) => item.title) ?? [],
            actor: { kind: 'workflow', runId, definitionId: view.run.definitionId, status },
          });
          continue;
        }
        if (target.mode !== 'evaluate' || !linkedTaskRun || linkedTaskRun.taskId !== target.id) continue;
        new TaskRunRepository().finalize({
          runId: linkedTaskRun.id,
          expectedVersion: linkedTaskRun.version,
          receipt: {
            status,
            summary,
            changes: [],
            evidence: (view.run.result?.artifacts ?? []).map((artifact) => ({
              kind: 'artifact',
              title: artifact.title ?? artifact.name,
              summary: artifact.name,
              provenance: 'tool',
              strength: 'observed',
              observedAt: artifact.createdAtMs,
            })),
            verification: { status: 'unverified', checks: [] },
            remainingWork: status === 'succeeded' ? [] : [view.run.error?.message ?? 'Workflow did not complete'],
            ...(view.run.result?.followUps?.[0]?.title ? { nextAction: view.run.result.followUps[0].title } : {}),
            needsUser: true,
            completionVerdict: status === 'succeeded' ? 'partial' : 'not_achieved',
            ...(status === 'failed' ? {
              failure: {
                code: view.run.error?.code ?? 'runtime_error',
                phase: 'workflow',
                recoveryAction: 'Review the workflow result and retry when ready.',
              },
            } : {}),
            contextTraceId: view.run.metadata?.contextSnapshot?.traceId,
          },
          actor: { kind: 'agent', id: view.run.metadata?.agentId },
        });
      }
    } catch (err) {
      log.warn({ err, runId, phase: 'writeback' }, 'Workflow result writeback failed');
    }
  }
}

export function resolveWorkflowWritebackPolicy(
  requested: WorkflowRunMetadata['writebackPolicy'] | undefined,
  scope: { projectId?: string; taskId?: string },
): NonNullable<WorkflowRunMetadata['writebackPolicy']> {
  const targets = (requested?.targets ?? defaultTargets(scope)).filter((target, index, all) => (
    all.findIndex((candidate) => candidate.kind === target.kind
      && candidate.id === target.id
      && candidate.mode === target.mode) === index
  ));
  for (const target of targets) {
    if (target.kind === 'project') {
      if (!scope.projectId || target.id !== scope.projectId || !['record', 'suggest'].includes(target.mode)) {
        throw new Error('Workflow project writeback must target the bound project');
      }
      continue;
    }
    if (!scope.taskId || target.id !== scope.taskId || target.mode !== 'evaluate') {
      throw new Error('Workflow task writeback must evaluate the linked task');
    }
  }
  return { targets };
}

function defaultTargets(scope: { projectId?: string; taskId?: string }): NonNullable<WorkflowRunMetadata['writebackPolicy']>['targets'] {
  return [
    ...(scope.projectId ? [{ kind: 'project' as const, id: scope.projectId, mode: 'record' as const }] : []),
    ...(scope.taskId ? [{ kind: 'task' as const, id: scope.taskId, mode: 'evaluate' as const }] : []),
  ];
}
