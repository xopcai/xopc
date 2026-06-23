// Cron job executor with timeout, retry logic and agent integration
import type { WorkflowRunView } from '../workflows/domain/index.js';
import type {
  CronRunOutcome,
  CronWorkflowRunStarter,
  HeartbeatWakeSink,
  JobData,
  JobExecution,
  JobExecutor,
  JobExecutorDeps,
} from './types.js';
import type { OutboundMessage } from '../channels/transport-types.js';
import { createLogger } from '../utils/logger.js';
import {
  getChannelPlugin,
} from '../channels/plugins/registry.js';
import { getCronPayloadText } from './job-content.js';
import type { CronRunLogStore } from './run-log-store.js';
import {
  DEFAULT_ACK_MAX_CHARS,
  NO_REPLY,
  shouldSilence,
  stripHeartbeatToken,
} from '../heartbeat/tokens.js';
import { DEFAULT_AGENT_ID, normalizeAgentId } from '../agent/agent-scope.js';
import { buildSessionKey } from '../routing/session-key.js';
import {
  buildWorkflowRunCronSummary,
  buildWorkflowRunDeliveryText,
  isWorkflowRunCronSuccess,
  resolveWorkflowCronWaitMs,
  waitForWorkflowRunView,
} from './workflow-run-completion.js';

const log = createLogger('CronExecutor');

// Error backoff schedule in ms
const ERROR_BACKOFF_MS = [
  30_000,   // 1st error  →  30s
  60_000,   // 2nd error  →  1min
  5 * 60_000,   // 3rd error  →  5min
  15 * 60_000,  // 4th error  →  15min
  60 * 60_000,  // 5th+ error →  60min
];

function errorBackoffMs(consecutiveErrors: number): number {
  const idx = Math.min(consecutiveErrors - 1, ERROR_BACKOFF_MS.length - 1);
  return ERROR_BACKOFF_MS[Math.max(0, idx)];
}

function resolveIsolatedCronJobModel(job: JobData): string | undefined {
  if (job.payload?.kind === 'agentTurn') {
    const m = job.payload.model?.trim();
    if (m) return m;
  }
  return undefined;
}

async function postCronWebhook(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Webhook delivery failed: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`);
  }
}

export class DefaultJobExecutor implements JobExecutor {
  private history: Map<string, JobExecution[]> = new Map();
  private runningJobs = new Map<string, AbortController>();
  private agentService: any = null;
  private messageBus: any = null;
  private heartbeatService: HeartbeatWakeSink | null = null;
  private sessionStore: JobExecutorDeps['sessionStore'] | undefined;
  private runLogStore: CronRunLogStore | null = null;
  private getDefaultCronAgentId: (() => string) | null = null;
  private workflowRunService: CronWorkflowRunStarter | null = null;
  private goalRunner: JobExecutorDeps['goalRunner'] | null = null;

  setRunLogStore(store: CronRunLogStore | null): void {
    this.runLogStore = store;
  }

  setDeps(deps: JobExecutorDeps): void {
    this.agentService = deps.agentService;
    this.messageBus = deps.messageBus;
    this.heartbeatService = deps.heartbeatService ?? null;
    if (deps.sessionStore !== undefined) {
      this.sessionStore = deps.sessionStore;
    }
    this.getDefaultCronAgentId = deps.getDefaultCronAgentId ?? null;
    this.workflowRunService = deps.workflowRunService ?? null;
    this.goalRunner = deps.goalRunner ?? null;
  }

  private async buildCronOutboundMessage(
    channel: string,
    to: string,
    content: string,
  ): Promise<OutboundMessage> {
    const plugin = getChannelPlugin(channel);
    if (plugin?.cronDelivery) {
      const { chatId, accountId, metadata } = await plugin.cronDelivery.normalizeDeliveryTarget(
        to,
        this.sessionStore,
      );
      const meta =
        accountId || metadata
          ? { ...(metadata ?? {}), ...(accountId ? { accountId } : {}) }
          : undefined;
      return {
        channel,
        chat_id: chatId,
        content,
        type: 'message',
        ...(meta && Object.keys(meta).length > 0 ? { metadata: meta } : {}),
      };
    }
    return {
      channel,
      chat_id: to,
      content,
      type: 'message',
    };
  }

  async execute(job: JobData, signal: AbortSignal, deps?: JobExecutorDeps): Promise<void> {
    // Set deps if provided
    if (deps) {
      this.setDeps(deps);
    }

    const executionId = crypto.randomUUID();
    const execution: JobExecution = {
      id: executionId,
      jobId: job.id,
      status: 'running',
      startedAt: new Date().toISOString(),
      retryCount: 0,
      sessionId: job.sessionKey,
      sessionKey: job.sessionKey,
      sessionType: job.sessionKey ? 'cron' : undefined,
    };

    // Record execution start
    this.addToHistory(job.id, execution);
    if (this.runLogStore) {
      await this.runLogStore.upsert(execution);
    }
    this.runningJobs.set(job.id, new AbortController());

    log.info(
      { jobId: job.id, executionId, preview: getCronPayloadText(job).slice(0, 100) },
      'Job executing'
    );

    let result: CronRunOutcome;

    try {
      // Check for cancellation
      if (signal.aborted) {
        throw new Error('Job was cancelled before execution');
      }

      // Execute the job
      result = await this.performJob(job, signal);

      // Mark as success/failed
      execution.status = result.status === 'ok' ? 'success' : result.status === 'skipped' ? 'cancelled' : 'failed';
      execution.endedAt = new Date().toISOString();
      execution.duration = Date.now() - new Date(execution.startedAt).getTime();
      execution.summary = result.summary;
      execution.error = result.error;
      execution.sessionId = result.sessionId;
      execution.sessionKey = result.sessionKey;
      execution.sessionType = result.sessionType;
      execution.model = result.model;
      execution.workflowRunId = result.workflowRunId;

      if (result.status === 'ok') {
        log.info(
          { jobId: job.id, executionId, duration: execution.duration },
          'Job completed'
        );
      } else if (result.status === 'skipped') {
        log.warn({ jobId: job.id, executionId, reason: result.error }, 'Job skipped');
      } else {
        log.error(
          { jobId: job.id, executionId, errorMessage: result.error, phase: 'cron.execute' },
          `Job failed: ${result.error ?? 'unknown'}`,
        );
      }

      if (result.status === 'ok' && job.wakeMode === 'next-heartbeat' && this.heartbeatService) {
        try {
          this.heartbeatService.requestNow({ reason: `cron:${job.id}` });
        } catch (e) {
          log.warn({ jobId: job.id, err: e }, 'Heartbeat wake after cron failed');
        }
      }
    } catch (error) {
      execution.status = 'failed';
      execution.endedAt = new Date().toISOString();
      execution.duration = Date.now() - new Date(execution.startedAt).getTime();
      execution.error = error instanceof Error ? error.message : String(error);

      log.error(
        {
          err: error,
          errorMessage: execution.error,
          jobId: job.id,
          executionId,
          phase: 'cron.execute',
        },
        `Job execution error: ${execution.error}`,
      );

      result = {
        status: 'error',
        error: execution.error,
      };
    } finally {
      this.runningJobs.delete(job.id);
    }

    if (this.runLogStore) {
      await this.runLogStore.upsert(execution);
    }

    return;
  }

  /**
   * Perform the actual job work - integrate with AgentService
   */
  protected async performJob(job: JobData, signal: AbortSignal): Promise<CronRunOutcome> {
    const timeout =
      job.payload.kind === 'agentTurn' && job.payload.timeoutSeconds
        ? job.payload.timeoutSeconds * 1000
        : 180_000;
    const sessionTarget = job.sessionTarget;

    // Check for abort before starting
    if (signal.aborted) {
      return { status: 'skipped', error: 'Job was aborted before execution' };
    }

    try {
      if (job.payload.kind === 'goalContinue') {
        return await this.executeGoalContinue(job);
      }

      if (job.payload.kind === 'workflowRun') {
        return await this.executeWorkflowRun(job, signal);
      }

      // If no agent service, fall back to basic execution
      if (!this.agentService || !this.messageBus) {
        log.warn({ jobId: job.id }, 'No agent service configured, using basic execution');
        return this.basicExecute(job, signal, timeout);
      }

      if (sessionTarget === 'main') {
        return await this.executeMainSession(job, signal, timeout);
      } else {
        return await this.executeIsolated(job, signal, timeout);
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeGoalContinue(job: JobData): Promise<CronRunOutcome> {
    if (job.payload.kind !== 'goalContinue') {
      return { status: 'error', error: 'Cron job payload is not goalContinue' };
    }
    if (!this.goalRunner) {
      return { status: 'error', error: 'Goal runner is not configured for cron' };
    }
    const item = this.goalRunner.enqueue(job.payload.goalId, {
      message: job.payload.message,
      maxRetries: job.payload.maxRetries ?? 0,
      source: 'cron',
    });
    return {
      status: 'ok',
      summary: `Queued goal ${job.payload.goalId} (${item.status})`,
      sessionId: item.sessionKey,
      sessionKey: item.sessionKey,
      sessionType: 'goal',
    };
  }

  private async executeWorkflowRun(job: JobData, signal: AbortSignal): Promise<CronRunOutcome> {
    if (signal.aborted) {
      return { status: 'skipped', error: 'Job was aborted before workflow run start' };
    }

    if (job.payload.kind !== 'workflowRun') {
      return { status: 'error', error: 'Cron job payload is not workflowRun' };
    }

    if (!this.workflowRunService) {
      return { status: 'error', error: 'Workflow run service is not configured for cron' };
    }

    const fallbackAgentId = this.getDefaultCronAgentId?.() ?? DEFAULT_AGENT_ID;
    const agentId = normalizeAgentId(job.payload.agentId || job.agentId || fallbackAgentId);
    const fireId = job.payload.source?.fireId || crypto.randomUUID();
    const source = {
      kind: 'cron' as const,
      scheduleId: job.payload.source?.scheduleId || job.id,
      fireId,
      scheduledAtMs: job.payload.source?.scheduledAtMs ?? Date.now(),
    };
    const result = await this.workflowRunService.startWorkflowRun({
      agentId,
      definitionId: job.payload.definitionId,
      input: job.payload.input,
      inputEnvelope: job.payload.inputEnvelope,
      goal: job.payload.goal,
      source,
      idempotencyKey: `cron:${job.id}:${fireId}`,
    });

    if (result.ok === false) {
      return {
        status: 'error',
        error: result.message,
      };
    }

    log.info(
      {
        jobId: job.id,
        workflowRunId: result.runId,
        definitionId: job.payload.definitionId,
        sessionKey: result.sessionKey,
      },
      'Workflow run started from cron',
    );

    const waitForCompletion = job.payload.waitForCompletion !== false;
    if (!waitForCompletion || !this.workflowRunService.readWorkflowRunView) {
      return {
        status: 'ok',
        summary: `Started workflow run ${result.runId}`,
        sessionId: result.sessionKey,
        sessionKey: result.sessionKey,
        sessionType: 'workflow',
        workflowRunId: result.runId,
      };
    }

    return this.waitForWorkflowRunOutcome({
      job,
      agentId,
      sessionKey: result.sessionKey,
      initialRunId: result.runId,
      signal,
    });
  }

  private async waitForWorkflowRunOutcome(params: {
    job: JobData;
    agentId: string;
    sessionKey: string;
    initialRunId: string;
    signal: AbortSignal;
  }): Promise<CronRunOutcome> {
    const waitMs = resolveWorkflowCronWaitMs(180_000);
    const maxWorkflowRetries =
      params.job.payload.kind === 'workflowRun'
        ? Math.max(0, Math.floor(params.job.payload.maxRetries ?? 0))
        : 0;
    let runId = params.initialRunId;
    let attempt = 0;

    while (attempt <= maxWorkflowRetries) {
      const waitResult = await waitForWorkflowRunView({
        readView: (id) => this.workflowRunService!.readWorkflowRunView!(params.agentId, id),
        runId,
        signal: params.signal,
        timeoutMs: waitMs,
      });

      if (waitResult.kind === 'aborted') {
        return { status: 'skipped', error: 'Job was aborted while waiting for workflow run' };
      }

      if (waitResult.kind === 'timeout') {
        return {
          status: 'error',
          error: `Workflow run ${runId} did not finish within ${waitMs}ms`,
          summary: waitResult.lastView ? buildWorkflowRunCronSummary(waitResult.lastView) : undefined,
          sessionId: params.sessionKey,
          sessionKey: params.sessionKey,
          sessionType: 'workflow',
          workflowRunId: runId,
        };
      }

      const view = waitResult.view;
      const summary = buildWorkflowRunCronSummary(view);
      const succeeded = isWorkflowRunCronSuccess(view);

      if (succeeded) {
        const baseOutcome: CronRunOutcome = {
          status: 'ok',
          summary,
          sessionId: params.sessionKey,
          sessionKey: params.sessionKey,
          sessionType: 'workflow',
          workflowRunId: runId,
        };
        await this.deliverWorkflowRunOutcome(params.job, view, baseOutcome);
        return baseOutcome;
      }

      const canRetry =
        attempt < maxWorkflowRetries &&
        view.run.status === 'failed' &&
        Boolean(this.workflowRunService?.retryWorkflowRun);

      if (!canRetry) {
        return {
          status: 'error',
          summary,
          error: summary,
          sessionId: params.sessionKey,
          sessionKey: params.sessionKey,
          sessionType: 'workflow',
          workflowRunId: runId,
        };
      }

      const retryResult = await this.workflowRunService!.retryWorkflowRun!({
        agentId: params.agentId,
        runId,
      });
      if (retryResult.ok === false) {
        return {
          status: 'error',
          error: retryResult.message,
          summary,
          sessionId: params.sessionKey,
          sessionKey: params.sessionKey,
          sessionType: 'workflow',
          workflowRunId: runId,
        };
      }

      runId = retryResult.runId;
      attempt += 1;
      log.info(
        { jobId: params.job.id, attempt, workflowRunId: runId },
        'Retrying failed workflow run from cron',
      );
    }

    return {
      status: 'error',
      error: 'Workflow run retries exhausted',
      sessionId: params.sessionKey,
      sessionKey: params.sessionKey,
      sessionType: 'workflow',
      workflowRunId: runId,
    };
  }

  private async deliverWorkflowRunOutcome(
    job: JobData,
    view: WorkflowRunView,
    outcome: CronRunOutcome,
  ): Promise<void> {
    const delivery = job.delivery;
    if (!delivery || delivery.mode === 'none' || delivery.channel === 'local' || !delivery.to?.trim()) {
      return;
    }

    try {
      const text = buildWorkflowRunDeliveryText(view);
      if (delivery.mode === 'webhook') {
        await postCronWebhook(delivery.to, {
          jobId: job.id,
          jobName: job.name,
          payloadKind: job.payload.kind,
          workflowRunId: view.run.id,
          status: view.run.status,
          text,
          run: view.run,
        });
        log.info({ jobId: job.id, workflowRunId: view.run.id }, 'Delivered workflow run webhook from cron');
        return;
      }
      if (!this.messageBus || !delivery.channel) return;
      const outbound = await this.buildCronOutboundMessage(delivery.channel!, delivery.to!, text);
      await this.messageBus.publishOutbound(outbound);
      log.info(
        { jobId: job.id, channel: delivery.channel, to: outbound.chat_id, workflowRunId: view.run.id },
        'Delivered workflow run result from cron',
      );
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ jobId: job.id, err, workflowRunId: view.run.id }, `Workflow cron delivery failed: ${em}`);
      if (outcome.status === 'ok') {
        outcome.summary = `${outcome.summary ?? ''} (delivery failed: ${em})`.trim();
      }
    }
  }

  /**
   * Execute in main session - sends system event
   */
  private async executeMainSession(
    job: JobData,
    signal: AbortSignal,
    timeout: number
  ): Promise<CronRunOutcome> {
    const text = getCronPayloadText(job);

    if (!text || !text.trim()) {
      return { status: 'skipped', error: 'Main session job requires non-empty message' };
    }

    const delivery = job.delivery;
    const channel = delivery?.channel ?? 'local';
    const to = delivery?.to ?? '';
    const actualMessage = text;

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Job timed out after ${timeout}ms`)), timeout);
    });

    // Create execution promise
    const executePromise = (async () => {
      // Check for abort
      if (signal.aborted) {
        throw new Error('Job was aborted');
      }

      if (!delivery || delivery.mode === 'none' || channel === 'local') {
        log.info(
          { jobId: job.id, messageLength: actualMessage.length },
          'Cron main session: no outbound publish'
        );
        return {
          status: 'ok' as const,
          summary: actualMessage.slice(0, 200),
        };
      }

      if (delivery.mode === 'webhook') {
        if (!to.trim()) {
          throw new Error('Webhook delivery requires delivery.to');
        }
        await postCronWebhook(to, {
          jobId: job.id,
          jobName: job.name,
          payloadKind: job.payload.kind,
          text: actualMessage,
        });
        return {
          status: 'ok' as const,
          summary: actualMessage.slice(0, 200),
        };
      }

      if (!this.messageBus) {
        return { status: 'error' as const, error: 'MessageBus not available' };
      }

      const outbound = await this.buildCronOutboundMessage(channel, to, actualMessage);

      await this.messageBus.publishOutbound(outbound);

      log.info(
        { jobId: job.id, channel, to: outbound.chat_id, messageLength: actualMessage.length },
        'Sent message to main session'
      );

      return {
        status: 'ok' as const,
        summary: actualMessage.slice(0, 200),
      };
    })();

    // Race against timeout
    return await Promise.race([executePromise, timeoutPromise]);
  }

  /**
   * Execute in isolated mode - runs agent independently
   */
  private async executeIsolated(
    job: JobData,
    signal: AbortSignal,
    timeout: number
  ): Promise<CronRunOutcome> {
    const message = getCronPayloadText(job);

    if (!message || !message.trim()) {
      return { status: 'skipped', error: 'Isolated job requires non-empty message' };
    }

    const explicitSessionKey =
      job.sessionTarget.startsWith('session:')
        ? job.sessionTarget.slice('session:'.length).trim()
        : job.sessionTarget === 'current'
          ? job.sessionKey?.trim()
          : job.sessionTarget === 'isolated'
            ? job.sessionKey?.trim()
          : undefined;
    const aid = job.agentId?.trim();
    const fallbackAgentId = this.getDefaultCronAgentId?.() ?? DEFAULT_AGENT_ID;
    const sessionKey = explicitSessionKey || buildSessionKey({
      agentId: normalizeAgentId(aid || fallbackAgentId),
      source: 'cron',
      accountId: 'default',
      peerKind: 'dm',
      peerId: `${job.id}-${crypto.randomUUID().slice(0, 8)}`,
    });

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Job timed out after ${timeout}ms`)), timeout);
    });

    // Create execution promise
    const executePromise = (async () => {
      // Check for abort
      if (signal.aborted) {
        throw new Error('Job was aborted');
      }

      await this.agentService.sessionConfig.applyCronJobWorkingDirectory(sessionKey, job.workingDirectory);

      const jobModel = resolveIsolatedCronJobModel(job);
      if (jobModel) {
        const ok = await this.agentService.sessionConfig.applyCronJobModelOverride(sessionKey, jobModel);
        if (!ok) {
          log.warn({ jobId: job.id, sessionKey, model: jobModel }, 'Cron job model invalid; using agent default');
        }
      } else {
        await this.agentService.sessionConfig.applyCronJobModelOverride(sessionKey, undefined);
      }

      const response = await this.agentService.turnDispatcher.processDirect(message, sessionKey);

      const model = this.agentService.getModelForSession(sessionKey);

      log.info(
        { jobId: job.id, sessionKey, responseLength: response.length, model },
        'Agent execution completed'
      );

      // Handle delivery (`local` channel or `mode: none` = no outbound; transcript in SessionStore)
      const delivery = job.delivery;
      const outboundChannel = delivery?.channel;
      const shouldPublish =
        delivery &&
        delivery.mode !== 'none' &&
        delivery.to;

      if (shouldPublish) {
        if (shouldSilence(response, DEFAULT_ACK_MAX_CHARS) || response.trim() === NO_REPLY) {
          return {
            status: 'ok' as const,
            summary: response.slice(0, 200),
            sessionId: sessionKey,
            sessionKey,
            sessionType: 'cron',
            model,
          };
        }
        const { stripped } = stripHeartbeatToken(response);
        const outboundText = stripped || response.trim();

        if (delivery.mode === 'webhook') {
          await postCronWebhook(delivery.to, {
            jobId: job.id,
            jobName: job.name,
            payloadKind: job.payload.kind,
            sessionKey,
            model,
            text: outboundText,
          });
          log.info({ jobId: job.id }, 'Delivered agent response webhook');
          return {
            status: 'ok' as const,
            summary: response.slice(0, 200),
            sessionId: sessionKey,
            sessionKey,
            sessionType: 'cron',
            model,
          };
        }
        if (outboundChannel === 'local') {
          return {
            status: 'ok' as const,
            summary: response.slice(0, 200),
            sessionId: sessionKey,
            sessionKey,
            sessionType: 'cron',
            model,
          };
        }
        const targetChannel = outboundChannel || 'cli';
        const outbound = await this.buildCronOutboundMessage(targetChannel, delivery.to, outboundText);

        await this.messageBus.publishOutbound(outbound);

        log.info(
          { jobId: job.id, channel: targetChannel, to: outbound.chat_id },
          'Delivered agent response'
        );

        return {
          status: 'ok' as const,
          summary: response.slice(0, 200),
          sessionId: sessionKey,
          sessionKey,
          sessionType: 'cron',
          model,
        };
      }

      // No outbound delivery: transcript is in SessionStore under `sessionKey`.
      return {
        status: 'ok' as const,
        summary: response.slice(0, 200),
        sessionId: sessionKey,
        sessionKey,
        sessionType: 'cron',
        model,
      };
    })();

    // Race against timeout
    try {
      return await Promise.race([executePromise, timeoutPromise]);
    } finally {
      const { retireSessionMcpRuntimeForSessionKey } = await import('../agent/mcp/bundle-mcp-tools.js');
      await retireSessionMcpRuntimeForSessionKey({
        sessionKey,
        reason: 'cron-isolated-end',
      }).catch(() => {});
    }
  }

  /**
   * Basic execution without agent service (fallback)
   */
  private async basicExecute(
    job: JobData,
    signal: AbortSignal,
    timeout: number
  ): Promise<CronRunOutcome> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Job timed out after ${timeout}ms`));
      }, timeout);

      // Listen for abort signal
      const abortHandler = () => {
        clearTimeout(timeoutId);
        reject(new Error('Job was aborted'));
      };
      signal.addEventListener('abort', abortHandler);

      // Simulate basic work
      setTimeout(() => {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', abortHandler);

        if (signal.aborted) {
          reject(new Error('Job was aborted'));
        } else {
          resolve({
            status: 'ok',
            summary: `Executed: ${getCronPayloadText(job).slice(0, 100)}`,
          });
        }
      }, 100);
    });
  }

  /**
   * Cancel a running job
   */
  cancelJob(jobId: string): boolean {
    const controller = this.runningJobs.get(jobId);
    if (controller) {
      controller.abort();
      this.runningJobs.delete(jobId);
      return true;
    }
    return false;
  }

  /**
   * Get execution history for a job
   */
  getHistory(jobId: string, limit = 10): JobExecution[] {
    const history = this.history.get(jobId) || [];
    return history.slice(-limit);
  }

  /**
   * Get currently running executions
   */
  getRunningExecutions(): JobExecution[] {
    const result: JobExecution[] = [];
    for (const [jobId] of this.runningJobs) {
      const history = this.history.get(jobId);
      if (history) {
        const running = history.find((e) => e.status === 'running');
        if (running) result.push(running);
      }
    }
    return result;
  }

  /**
   * Check if a job is currently running
   */
  isRunning(jobId: string): boolean {
    return this.runningJobs.has(jobId);
  }

  /**
   * Get consecutive error count for a job
   */
  getConsecutiveErrors(jobId: string): number {
    const history = this.history.get(jobId) || [];
    // Find last execution
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].status !== 'running') {
        if (history[i].status === 'failed' || history[i].status === 'cancelled') {
          // Count consecutive errors before this
          let count = 0;
          for (let j = i - 1; j >= 0; j--) {
            if (history[j].status === 'failed' || history[j].status === 'cancelled') {
              count++;
            } else {
              break;
            }
          }
          return count + 1;
        }
        return 0;
      }
    }
    return 0;
  }

  /**
   * Calculate backoff delay for a job
   */
  calculateBackoff(jobId: string): number {
    const errors = this.getConsecutiveErrors(jobId);
    return errorBackoffMs(errors);
  }

  /**
   * Clear old history entries
   */
  cleanupHistory(maxAgeDays = 7): void {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    for (const [jobId, executions] of this.history) {
      this.history.set(
        jobId,
        executions.filter((e) => new Date(e.startedAt).getTime() > cutoff)
      );
    }
  }

  private addToHistory(jobId: string, execution: JobExecution): void {
    const existing = this.history.get(jobId) || [];
    existing.push(execution);
    // Keep last 100 executions per job
    if (existing.length > 100) {
      existing.shift();
    }
    this.history.set(jobId, existing);
  }
}
