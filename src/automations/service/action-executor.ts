import crypto from 'node:crypto';

import { DEFAULT_AGENT_ID, normalizeAgentId } from '../../agent/agent-scope.js';
import { buildSessionKey } from '../../routing/session-key.js';
import { createLogger } from '../../utils/logger.js';
import type {
  Automation,
  AutomationAction,
  AutomationActionOutcome,
  AutomationDeps,
  AutomationRun,
} from '../domain/types.js';
import { DEFAULT_AUTOMATION_TIMEOUT_SECONDS } from '../domain/defaults.js';

const log = createLogger('Automation:ActionExecutor');

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Automation run was cancelled'));
      return;
    }
    const timer = setTimeout(() => reject(new Error(`Automation timed out after ${timeoutMs}ms`)), timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Automation run was cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export class AutomationActionExecutor {
  private deps: AutomationDeps = {};

  setDeps(deps: AutomationDeps): void {
    this.deps = { ...this.deps, ...deps };
  }

  async execute(
    automation: Automation,
    run: AutomationRun,
    signal: AbortSignal,
  ): Promise<AutomationActionOutcome> {
    const timeoutMs =
      (automation.action.timeoutSeconds ?? automation.reliability?.timeoutSeconds ?? 0) > 0
        ? (automation.action.timeoutSeconds ?? automation.reliability?.timeoutSeconds)! * 1000
        : DEFAULT_AUTOMATION_TIMEOUT_SECONDS * 1000;

    return withTimeout(this.executeWithoutTimeout(automation, run, signal), timeoutMs, signal).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: message.toLowerCase().includes('cancelled')
          ? 'cancelled'
          : message.toLowerCase().includes('timed out')
            ? 'timeout'
            : 'failed',
        error: message,
      };
    });
  }

  private async executeWithoutTimeout(
    automation: Automation,
    run: AutomationRun,
    signal: AbortSignal,
  ): Promise<AutomationActionOutcome> {
    if (signal.aborted) {
      return { status: 'cancelled', error: 'Automation run was cancelled' };
    }
    if (automation.action.kind === 'workflow') {
      return this.executeWorkflow(automation, automation.action, run);
    }
    if (automation.action.kind === 'browser_recipe') {
      return this.executeBrowserRecipe(automation, automation.action, signal);
    }
    return this.executeAgent(automation, automation.action);
  }

  private async executeBrowserRecipe(
    automation: Automation,
    action: Extract<AutomationAction, { kind: 'browser_recipe' }>,
    signal: AbortSignal,
  ): Promise<AutomationActionOutcome> {
    const safetyMode = automation.safety?.mode ?? 'auto_apply';
    if (safetyMode !== 'auto_apply') {
      return {
        status: 'succeeded',
        summary: `${safetyMode === 'suggest_only' ? 'Suggest only' : 'Ask before applying'}: Browser automation ${action.recipeId} was not run.`,
      };
    }
    const service = this.deps.browserRecipeService;
    if (!service) return { status: 'failed', error: 'Browser automation is not available' };
    const run = await service.runAndWait(action.recipeId, action.args ?? {}, signal);
    if (run.status === 'succeeded') {
      return {
        status: 'succeeded',
        summary: `Browser automation ${action.recipeId} completed: ${JSON.stringify(run.result ?? null).slice(0, 3_500)}`,
      };
    }
    return {
      status: run.status === 'cancelled' ? 'cancelled' : 'failed',
      error: run.error ?? `Browser automation ${action.recipeId} ${run.status}`,
    };
  }

  private async executeAgent(
    automation: Automation,
    action: Extract<AutomationAction, { kind: 'agent' }>,
  ): Promise<AutomationActionOutcome> {
    const agentService = this.deps.agentService;
    if (!agentService?.turnDispatcher?.processDirect) {
      return { status: 'failed', error: 'Agent service is not available' };
    }
    const agentId = normalizeAgentId(
      action.agentId || this.deps.getDefaultAgentId?.() || DEFAULT_AGENT_ID,
    );
    const sessionKey = buildSessionKey({
      agentId,
      source: 'automation',
      accountId: 'default',
      peerKind: 'dm',
      peerId: `${automation.id}-${crypto.randomUUID().slice(0, 8)}`,
    });
    const effectiveWorkingDirectory = action.workingDirectory
      ?? (automation.projectId ? this.deps.getProjectWorkspaceRoot?.(automation.projectId) : undefined);

    await agentService.sessionConfig?.applyAutomationWorkingDirectory?.(
      sessionKey,
      effectiveWorkingDirectory,
    );
    if (agentService.sessionConfig?.applyAutomationModelOverride) {
      const ok = await agentService.sessionConfig.applyAutomationModelOverride(sessionKey, action.model);
      if (!ok && action.model) {
        log.warn(
          { automationId: automation.id, sessionKey, model: action.model },
          'Automation model override invalid; using agent default',
        );
      }
    }

    const response = await agentService.turnDispatcher.processDirect(
      buildSafetyInstruction(automation, action.instruction),
      sessionKey,
    );
    const model = agentService.getModelForSession?.(sessionKey);
    return {
      status: 'succeeded',
      summary: response.slice(0, 4_000),
      sessionKey,
      model,
    };
  }

  private async executeWorkflow(
    automation: Automation,
    action: Extract<AutomationAction, { kind: 'workflow' }>,
    run: AutomationRun,
  ): Promise<AutomationActionOutcome> {
    const safetyMode = automation.safety?.mode ?? 'auto_apply';
    if (safetyMode === 'suggest_only') {
      return {
        status: 'succeeded',
        summary: `Suggest only: workflow ${action.workflowId} was not started. Review the automation and upgrade safety mode to run it automatically.`,
      };
    }
    if (safetyMode === 'ask_before_apply') {
      return {
        status: 'succeeded',
        summary: `Ask before applying: workflow ${action.workflowId} is ready, but was not started automatically. Upgrade to Auto apply when you trust this automation.`,
      };
    }
    const workflowRunService = this.deps.workflowRunService;
    if (!workflowRunService) {
      return { status: 'failed', error: 'Workflow service is not available' };
    }
    const agentId = normalizeAgentId(
      action.agentId || this.deps.getDefaultAgentId?.() || DEFAULT_AGENT_ID,
    );
    const idempotencyKey = `automation:${automation.id}:${run.id}`;
    const result = await workflowRunService.startWorkflowRun({
      agentId,
      definitionId: action.workflowId,
      input: action.input,
      inputEnvelope: action.inputEnvelope,
      goal: action.goal,
      projectId: automation.projectId,
      concurrency: action.concurrency,
      maxSubagents: action.maxSubagents,
      source: { kind: 'automation', automationId: automation.id, runId: run.id },
      idempotencyKey,
    });
    if (result.ok === false) {
      return { status: 'failed', error: result.message };
    }
    return {
      status: 'succeeded',
      summary: `Started workflow run ${result.runId}`,
      sessionKey: result.sessionKey,
      workflowRunId: result.runId,
    };
  }
}

function buildSafetyInstruction(automation: Automation, instruction: string): string {
  const mode = automation.safety?.mode ?? 'auto_apply';
  if (mode === 'suggest_only') {
    return [
      'Automation safety mode: Suggest only.',
      'Only analyze the situation and produce a concise recommendation.',
      'Do not modify files, notes, goals, workflows, external systems, or persistent state.',
      'If a change seems useful, describe the exact change for the user to review.',
      '',
      instruction,
    ].join('\n');
  }
  if (mode === 'ask_before_apply') {
    return [
      'Automation safety mode: Ask before applying.',
      'Draft the proposed change or action and clearly ask for user confirmation before applying anything.',
      'Do not perform irreversible or external side effects unless the user has explicitly approved them in this run.',
      '',
      instruction,
    ].join('\n');
  }
  return instruction;
}
