import crypto from 'node:crypto';

import { DEFAULT_AGENT_ID, normalizeAgentId } from '../../agent/agent-scope.js';
import { buildSessionKey } from '../../routing/session-key.js';
import { createLogger } from '../../utils/logger.js';
import type {
  Automation,
  AutomationAction,
  AutomationActionExecutionHooks,
  AutomationActionOutcome,
  AutomationDeps,
  AutomationRun,
} from '../domain/types.js';
import { resolveAutomationTimeoutSeconds } from '../domain/defaults.js';

const log = createLogger('Automation:ActionExecutor');
const CANCELLATION_GRACE_MS = 10_000;

class AutomationExecutionStoppedError extends Error {
  constructor(
    readonly status: 'timeout' | 'cancelled',
    readonly cancellationConfirmed: boolean,
    readonly deadlineAtMs: number,
    timeoutMs: number,
  ) {
    super(status === 'timeout'
      ? `Automation timed out after ${timeoutMs}ms`
      : 'Automation run was cancelled');
    this.name = 'AutomationExecutionStoppedError';
  }
}

async function waitForCancellation(promise: Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), CANCELLATION_GRACE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executeWithDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal: AbortSignal,
  deadlineAtMs: number,
): Promise<T> {
  const controller = new AbortController();
  let stoppedAs: 'timeout' | 'cancelled' | undefined;
  const stop = (status: 'timeout' | 'cancelled', reason?: unknown) => {
    if (controller.signal.aborted) return;
    stoppedAs = status;
    controller.abort(reason);
  };
  const onParentAbort = () => stop('cancelled', parentSignal.reason);
  parentSignal.addEventListener('abort', onParentAbort, { once: true });
  if (parentSignal.aborted) onParentAbort();
  const timer = setTimeout(
    () => stop('timeout', new Error(`Automation timed out after ${timeoutMs}ms`)),
    Math.max(0, deadlineAtMs - Date.now()),
  );

  const operationPromise = operation(controller.signal);
  const rejectForAbort = () => {
    throw controller.signal.reason ?? new Error('Automation run was cancelled');
  };
  let removeDeadlineAbortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    const rejectPromise = () => reject(controller.signal.reason ?? new Error('Automation run was cancelled'));
    if (controller.signal.aborted) rejectPromise();
    else {
      controller.signal.addEventListener('abort', rejectPromise, { once: true });
      removeDeadlineAbortListener = () => controller.signal.removeEventListener('abort', rejectPromise);
    }
  });

  try {
    const result = await Promise.race([operationPromise, abortPromise]);
    if (stoppedAs) rejectForAbort();
    return result;
  } catch (err) {
    if (!stoppedAs) throw err;
    const cancellationConfirmed = await waitForCancellation(operationPromise);
    throw new AutomationExecutionStoppedError(
      stoppedAs,
      cancellationConfirmed,
      deadlineAtMs,
      timeoutMs,
    );
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener('abort', onParentAbort);
    removeDeadlineAbortListener?.();
  }
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
    hooks: AutomationActionExecutionHooks = {},
  ): Promise<AutomationActionOutcome> {
    const configuredTimeoutMs = resolveAutomationTimeoutSeconds(
      automation.action,
      automation.reliability,
    ) * 1000;

    const deadlineAtMs = run.deadlineAtMs ?? Date.now() + configuredTimeoutMs;
    const timeoutMs = Math.max(1, deadlineAtMs - Date.now());
    await hooks.onRunPatch?.({ deadlineAtMs });
    return executeWithDeadline(
      (deadlineSignal) => this.executeWithoutTimeout(
        automation,
        run,
        deadlineSignal,
        hooks,
        deadlineAtMs,
      ),
      timeoutMs,
      signal,
      deadlineAtMs,
    ).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof AutomationExecutionStoppedError) {
        return {
          status: err.status,
          error: message,
          deadlineAtMs: err.deadlineAtMs,
          termination: {
            reason: err.status === 'timeout' ? 'deadline_exceeded' : 'user_cancelled',
            component: 'automation',
            cancellationConfirmed: err.cancellationConfirmed,
          },
        };
      }
      return {
        status: message.toLowerCase().includes('cancelled')
          ? 'cancelled'
          : message.toLowerCase().includes('timed out')
            ? 'timeout'
            : 'failed',
        error: message,
        deadlineAtMs,
      };
    });
  }

  private async executeWithoutTimeout(
    automation: Automation,
    run: AutomationRun,
    signal: AbortSignal,
    hooks: AutomationActionExecutionHooks,
    deadlineAtMs: number,
  ): Promise<AutomationActionOutcome> {
    if (signal.aborted) {
      return { status: 'cancelled', error: 'Automation run was cancelled' };
    }
    if (automation.action.kind === 'workflow') {
      return this.executeWorkflow(automation, automation.action, run, signal, hooks);
    }
    if (automation.action.kind === 'browser_recipe') {
      return this.executeBrowserRecipe(automation, automation.action, signal, hooks);
    }
    return this.executeAgent(automation, automation.action, run, signal, hooks, deadlineAtMs);
  }

  private async executeBrowserRecipe(
    automation: Automation,
    action: Extract<AutomationAction, { kind: 'browser_recipe' }>,
    signal: AbortSignal,
    hooks: AutomationActionExecutionHooks,
  ): Promise<AutomationActionOutcome> {
    await hooks.onRunPatch?.({ currentPhase: 'action' });
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
    run: AutomationRun,
    signal: AbortSignal,
    hooks: AutomationActionExecutionHooks,
    deadlineAtMs: number,
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

    await hooks.onRunPatch?.({ sessionKey, currentPhase: 'action' });

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
      undefined,
      undefined,
      { signal, runId: run.id, deadlineAtMs },
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
    signal: AbortSignal,
    hooks: AutomationActionExecutionHooks,
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
    await hooks.onRunPatch?.({
      sessionKey: result.sessionKey,
      workflowRunId: result.runId,
      currentPhase: 'action',
    });
    if (!workflowRunService.readWorkflowRunView) {
      return {
        status: 'succeeded',
        summary: `Started workflow run ${result.runId}`,
        sessionKey: result.sessionKey,
        workflowRunId: result.runId,
      };
    }

    while (!signal.aborted) {
      const view = await workflowRunService.readWorkflowRunView(agentId, result.runId);
      if (!view) {
        return { status: 'failed', error: `Workflow run ${result.runId} disappeared` };
      }
      const workflowStatus = view.run.status;
      if (workflowStatus === 'succeeded') {
        return {
          status: 'succeeded',
          summary: `Workflow run ${result.runId} completed`,
          sessionKey: result.sessionKey,
          workflowRunId: result.runId,
        };
      }
      if (workflowStatus === 'failed' || workflowStatus === 'cancelled' || workflowStatus === 'timeout') {
        return {
          status: workflowStatus,
          error: view.run.error?.message ?? `Workflow run ${result.runId} ${workflowStatus}`,
          sessionKey: result.sessionKey,
          workflowRunId: result.runId,
        };
      }
      await waitForSignalOrDelay(signal, 500);
    }
    await workflowRunService.cancelWorkflowRun?.({
      agentId,
      runId: result.runId,
      reason: 'Parent automation was cancelled or reached its deadline',
    });
    return {
      status: 'cancelled',
      error: 'Parent automation stopped while the workflow was running',
      sessionKey: result.sessionKey,
      workflowRunId: result.runId,
    };
  }
}

function waitForSignalOrDelay(signal: AbortSignal, delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
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
