import type { WorkflowEventEnvelope } from '../domain/event.js';
import type {
  WorkflowAgentStatus,
  WorkflowAgentView,
  WorkflowLogEntry,
  WorkflowPhaseStatus,
  WorkflowPhaseView,
  WorkflowRun,
  WorkflowRunView,
  WorkflowTimelineItem,
} from '../domain/run.js';
import { isTerminalWorkflowRunStatus } from '../domain/run.js';
import type { WorkflowArtifactRef } from '../domain/result.js';

function terminalRunStatus(status: WorkflowRun['status']): boolean {
  return isTerminalWorkflowRunStatus(status);
}

function phaseStatusAfterAgentStatus(agentStatuses: WorkflowAgentStatus[]): WorkflowPhaseStatus {
  if (agentStatuses.some((status) => status === 'running')) {
    return 'running';
  }
  if (agentStatuses.some((status) => status === 'error')) {
    return 'failed';
  }
  if (agentStatuses.length > 0 && agentStatuses.every((status) => status === 'done' || status === 'skipped')) {
    return 'completed';
  }
  return 'pending';
}

function buildTimelineItem(event: WorkflowEventEnvelope): WorkflowTimelineItem {
  return {
    sequence: event.sequence,
    type: event.type,
    title: event.type.replaceAll('_', ' '),
    createdAtMs: event.createdAtMs,
  };
}

export function projectWorkflowRunView(events: WorkflowEventEnvelope[]): WorkflowRunView | null {
  if (events.length === 0) {
    return null;
  }

  const orderedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
  const firstEvent = orderedEvents[0];
  if (firstEvent.type !== 'run_queued') {
    return null;
  }

  const firstPayload = firstEvent.payload as { run?: WorkflowRun };
  if (!firstPayload.run) {
    return null;
  }

  const run: WorkflowRun = {
    ...firstPayload.run,
    metrics: { ...firstPayload.run.metrics },
  };
  const phaseIdToPhase = new Map<string, WorkflowPhaseView>();
  const agentIdToAgent = new Map<string, WorkflowAgentView>();
  const logs: WorkflowLogEntry[] = [];
  const artifacts: WorkflowArtifactRef[] = [];
  const timeline: WorkflowTimelineItem[] = [];

  for (const event of orderedEvents) {
    timeline.push(buildTimelineItem(event));

    switch (event.type) {
      case 'run_started': {
        const payload = event.payload as { startedAtMs: number };
        run.status = 'running';
        run.startedAtMs = payload.startedAtMs;
        break;
      }
      case 'phase_started': {
        const payload = event.payload as { phaseId: string; title: string };
        phaseIdToPhase.set(payload.phaseId, {
          id: payload.phaseId,
          title: payload.title,
          status: 'running',
          startedAtMs: event.createdAtMs,
          agentIds: phaseIdToPhase.get(payload.phaseId)?.agentIds ?? [],
        });
        break;
      }
      case 'phase_completed': {
        const payload = event.payload as { phaseId: string };
        const existing = phaseIdToPhase.get(payload.phaseId);
        if (existing) {
          phaseIdToPhase.set(payload.phaseId, {
            ...existing,
            status: 'completed',
            completedAtMs: event.createdAtMs,
          });
        }
        break;
      }
      case 'agent_queued': {
        const payload = event.payload as { agentId: string; label: string; phaseId?: string; prompt?: string };
        agentIdToAgent.set(payload.agentId, {
          id: payload.agentId,
          label: payload.label,
          phaseId: payload.phaseId,
          status: 'queued',
          prompt: payload.prompt,
          steps: [],
        });
        if (payload.phaseId) {
          const existingPhase = phaseIdToPhase.get(payload.phaseId);
          if (existingPhase && !existingPhase.agentIds.includes(payload.agentId)) {
            phaseIdToPhase.set(payload.phaseId, {
              ...existingPhase,
              agentIds: [...existingPhase.agentIds, payload.agentId],
            });
          }
        }
        break;
      }
      case 'agent_started': {
        const payload = event.payload as { agentId: string };
        const existing = agentIdToAgent.get(payload.agentId);
        if (existing) {
          agentIdToAgent.set(payload.agentId, {
            ...existing,
            status: 'running',
            startedAtMs: event.createdAtMs,
          });
        }
        break;
      }
      case 'agent_step_started': {
        const payload = event.payload as {
          agentId: string;
          stepId: string;
          label: string;
          kind: 'tool' | 'llm' | 'thinking';
          detail?: string;
        };
        const existing = agentIdToAgent.get(payload.agentId);
        if (existing) {
          agentIdToAgent.set(payload.agentId, {
            ...existing,
            currentStep: payload.label,
            steps: [
              ...existing.steps,
              {
                id: payload.stepId,
                label: payload.label,
                kind: payload.kind,
                detail: payload.detail,
                status: 'running',
                startedAtMs: event.createdAtMs,
              },
            ],
          });
        }
        break;
      }
      case 'agent_step_completed': {
        const payload = event.payload as { agentId: string; stepId: string; status: 'done' | 'error' };
        const existing = agentIdToAgent.get(payload.agentId);
        if (existing) {
          agentIdToAgent.set(payload.agentId, {
            ...existing,
            steps: existing.steps.map((step) =>
              step.id === payload.stepId
                ? {
                    ...step,
                    status: payload.status,
                    completedAtMs: event.createdAtMs,
                  }
                : step,
            ),
          });
        }
        break;
      }
      case 'agent_completed': {
        const payload = event.payload as {
          agentId: string;
          status: WorkflowAgentStatus;
          resultPreview?: string;
          error?: string;
        };
        const existing = agentIdToAgent.get(payload.agentId);
        if (existing) {
          agentIdToAgent.set(payload.agentId, {
            ...existing,
            status: payload.status,
            currentStep: undefined,
            resultPreview: payload.resultPreview,
            error: payload.error,
            completedAtMs: event.createdAtMs,
          });
        }
        break;
      }
      case 'log_appended': {
        const payload = event.payload as { message: string };
        logs.push({ sequence: event.sequence, message: payload.message, createdAtMs: event.createdAtMs });
        break;
      }
      case 'artifact_created': {
        const payload = event.payload as { artifact: WorkflowArtifactRef };
        artifacts.push(payload.artifact);
        run.metrics.artifactCount = artifacts.length;
        break;
      }
      case 'run_completed': {
        const payload = event.payload as { result: WorkflowRun['result'] };
        run.status = 'succeeded';
        run.result = payload.result;
        run.completedAtMs = event.createdAtMs;
        break;
      }
      case 'run_failed': {
        const payload = event.payload as { error: WorkflowRun['error'] };
        run.status = payload.error?.code === 'timeout' ? 'timeout' : 'failed';
        run.error = payload.error;
        run.completedAtMs = event.createdAtMs;
        break;
      }
      case 'run_cancelled': {
        run.status = 'cancelled';
        run.completedAtMs = event.createdAtMs;
        for (const [agentId, agent] of agentIdToAgent) {
          if (agent.status !== 'queued' && agent.status !== 'running') {
            continue;
          }
          agentIdToAgent.set(agentId, {
            ...agent,
            status: 'skipped',
            currentStep: undefined,
            completedAtMs: event.createdAtMs,
            steps: agent.steps.map((step) =>
              step.status === 'running'
                ? { ...step, status: 'error', completedAtMs: event.createdAtMs }
                : step,
            ),
          });
        }
        break;
      }
      case 'run_queued':
      default:
        break;
    }
  }

  const agents = [...agentIdToAgent.values()];
  run.metrics.agentCount = agents.length;
  run.metrics.doneAgentCount = agents.filter((agent) => agent.status === 'done').length;
  run.metrics.errorAgentCount = agents.filter((agent) => agent.status === 'error').length;
  run.metrics.skippedAgentCount = agents.filter((agent) => agent.status === 'skipped').length;
  run.metrics.artifactCount = artifacts.length;
  if (run.startedAtMs && run.completedAtMs) {
    run.metrics.durationMs = run.completedAtMs - run.startedAtMs;
  }

  const phases = [...phaseIdToPhase.values()].map((phase) => {
    if (phase.status === 'completed' || phase.status === 'failed') {
      return phase;
    }
    const phaseAgents = phase.agentIds
      .map((agentId) => agentIdToAgent.get(agentId)?.status)
      .filter((status): status is WorkflowAgentStatus => Boolean(status));
    return { ...phase, status: phaseStatusAfterAgentStatus(phaseAgents) };
  });

  return {
    run,
    phases,
    agents,
    logs,
    artifacts,
    timeline,
    controls: {
      canCancel: !terminalRunStatus(run.status),
      canRetry: terminalRunStatus(run.status),
      canArchive: terminalRunStatus(run.status),
    },
  };
}
