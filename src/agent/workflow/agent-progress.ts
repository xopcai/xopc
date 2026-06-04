/**
 * Apply live subagent progress events onto a {@link WorkflowAgentSnapshot}.
 */

import type {
  SubagentProgressEvent,
  WorkflowAgentSnapshot,
  WorkflowAgentStep,
} from './types.js';
import { workflowStepLabel } from './step-labels.js';

const MAX_STEPS = 50;
const MAX_STREAM_TEXT = 32_000;

export function applySubagentProgress(
  agent: WorkflowAgentSnapshot,
  event: SubagentProgressEvent,
): boolean {
  switch (event.type) {
    case 'tool_start': {
      if (!agent.steps) agent.steps = [];
      const { label, detail } = workflowStepLabel(event.toolName, event.args);
      const step: WorkflowAgentStep = {
        id: event.toolCallId,
        kind: 'tool',
        toolName: event.toolName,
        label,
        detail,
        status: 'running',
        startedAtMs: Date.now(),
      };
      agent.steps.push(step);
      trimSteps(agent);
      agent.currentStep = formatCurrentStep(step);
      return true;
    }
    case 'tool_end': {
      const step = findStep(agent, event.toolCallId);
      if (!step) return false;
      step.status = event.isError ? 'error' : 'done';
      if (step.startedAtMs != null) step.durationMs = Date.now() - step.startedAtMs;
      if (agent.currentStep === formatCurrentStep(step)) {
        agent.currentStep = undefined;
      }
      return true;
    }
    case 'iteration': {
      agent.iteration = event.count;
      agent.maxIterations = event.max;
      return true;
    }
    case 'text_delta': {
      if (!event.delta) return false;
      agent.streamText = appendStreamText(agent.streamText, event.delta);
      return true;
    }
    case 'thinking_delta': {
      if (!event.delta) return false;
      agent.streamText = appendStreamText(agent.streamText, event.delta);
      return true;
    }
    default:
      return false;
  }
}

function findStep(agent: WorkflowAgentSnapshot, id: string): WorkflowAgentStep | undefined {
  return agent.steps?.find((s) => s.id === id);
}

function formatCurrentStep(step: WorkflowAgentStep): string {
  return step.detail ? `${step.label}: ${step.detail}` : step.label;
}

function trimSteps(agent: WorkflowAgentSnapshot): void {
  if (!agent.steps || agent.steps.length <= MAX_STEPS) return;
  agent.steps = agent.steps.slice(-MAX_STEPS);
}

function appendStreamText(existing: string | undefined, delta: string): string {
  const next = (existing ?? '') + delta;
  if (next.length <= MAX_STREAM_TEXT) return next;
  return next.slice(-MAX_STREAM_TEXT);
}
