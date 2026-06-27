import type { WorkflowSnapshot } from '@/features/chat/workflow/workflow.types';

import type { WorkflowRunView } from './workflow-api';

function agentNumericId(id: string, index: number): number {
  const parsed = Number.parseInt(id, 10);
  if (Number.isFinite(parsed)) return parsed;
  return index + 1;
}

/** Map gateway {@link WorkflowRunView} into chat {@link WorkflowSnapshot} for shared UI. */
export function runViewToSnapshot(view: WorkflowRunView): WorkflowSnapshot {
  const phaseTitleById = new Map(view.phases.map((phase) => [phase.id, phase.title]));
  const runningPhase = view.phases.find((phase) => phase.status === 'running');

  const agents = view.agents.map((agent, index) => ({
    id: agentNumericId(agent.id, index),
    label: agent.label,
    phase: agent.phaseId ? phaseTitleById.get(agent.phaseId) : undefined,
    prompt: agent.prompt ?? '',
    invocation: agent.invocation,
    sessionKey: agent.sessionKey,
    transcriptMessageCount: agent.transcriptMessageCount,
    status: agent.status,
    resultPreview: agent.resultPreview,
    error: agent.error,
    startedAtMs: agent.startedAtMs,
    durationMs:
      agent.startedAtMs != null && agent.completedAtMs != null
        ? agent.completedAtMs - agent.startedAtMs
        : undefined,
    currentStep: agent.currentStep,
    steps: agent.steps?.map((step) => ({
      id: step.id,
      kind: step.kind,
      toolName: step.toolName,
      label: step.label,
      detail: step.detail,
      status: step.status,
      resultPreview: step.resultPreview,
      error: step.error,
      startedAtMs: step.startedAtMs,
      durationMs:
        step.startedAtMs != null && step.completedAtMs != null
          ? step.completedAtMs - step.startedAtMs
          : undefined,
    })),
  }));

  const { metrics } = view.run;
  return {
    runId: view.run.id,
    name: view.run.definitionId,
    description: view.run.goal || view.run.title,
    phases: view.phases.map((phase) => phase.title),
    currentPhase: runningPhase?.title,
    logs: view.logs.map((entry) => entry.message),
    agents,
    agentCount: metrics.agentCount,
    runningCount: Math.max(0, metrics.agentCount - metrics.doneAgentCount - metrics.errorAgentCount - metrics.skippedAgentCount),
    doneCount: metrics.doneAgentCount,
    errorCount: metrics.errorAgentCount,
    skippedCount: metrics.skippedAgentCount,
    durationMs: metrics.durationMs,
    result: view.run.result,
  };
}
