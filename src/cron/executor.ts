// Cron job executor with timeout, retry logic and agent integration
import type {
  JobData,
  JobExecution,
  JobExecutor,
  JobExecutorDeps,
  CronRunOutcome,
} from './types.js';
import { createLogger } from '../utils/logger.js';

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

export class DefaultJobExecutor implements JobExecutor {
  private history: Map<string, JobExecution[]> = new Map();
  private runningJobs = new Map<string, AbortController>();
  private agentService: any = null;
  private messageBus: any = null;

  setDeps(deps: JobExecutorDeps): void {
    this.agentService = deps.agentService;
    this.messageBus = deps.messageBus;
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
    };

    // Record execution start
    this.addToHistory(job.id, execution);
    this.runningJobs.set(job.id, new AbortController());

    log.info(
      { jobId: job.id, executionId, message: job.message.slice(0, 100) },
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
      execution.model = result.model;

      if (result.status === 'ok') {
        log.info(
          { jobId: job.id, executionId, duration: execution.duration },
          'Job completed'
        );
      } else if (result.status === 'skipped') {
        log.warn({ jobId: job.id, executionId, reason: result.error }, 'Job skipped');
      } else {
        log.error(
          { jobId: job.id, executionId, error: result.error },
          'Job failed'
        );
      }
    } catch (error) {
      execution.status = 'failed';
      execution.endedAt = new Date().toISOString();
      execution.duration = Date.now() - new Date(execution.startedAt).getTime();
      execution.error = error instanceof Error ? error.message : String(error);

      log.error(
        { jobId: job.id, executionId, error: execution.error },
        'Job execution error'
      );

      result = {
        status: 'error',
        error: execution.error,
      };
    } finally {
      this.runningJobs.delete(job.id);
    }

    // Return result for caller to handle retry/backoff
    return;
  }

  /**
   * Perform the actual job work - integrate with AgentService
   */
  protected async performJob(job: JobData, signal: AbortSignal): Promise<CronRunOutcome> {
    const timeout = job.timeout || 60000;
    const sessionTarget = job.sessionTarget || 'main';

    // Check for abort before starting
    if (signal.aborted) {
      return { status: 'skipped', error: 'Job was aborted before execution' };
    }

    // If no agent service, fall back to basic execution
    if (!this.agentService || !this.messageBus) {
      log.warn({ jobId: job.id }, 'No agent service configured, using basic execution');
      return this.basicExecute(job, signal, timeout);
    }

    try {
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

  /**
   * Execute in main session - sends system event
   */
  private async executeMainSession(
    job: JobData,
    signal: AbortSignal,
    timeout: number
  ): Promise<CronRunOutcome> {
    // Get message text from payload or fallback to job message
    const text = job.payload?.kind === 'systemEvent'
      ? job.payload.text
      : job.message;

    if (!text || !text.trim()) {
      return { status: 'skipped', error: 'Main session job requires non-empty message' };
    }

    // Parse delivery from job config or fallback to parsing from message
    // Support legacy format: "channel:chat_id:message"
    let channel: string;
    let to: string;
    let actualMessage: string;

    if (job.delivery?.channel && job.delivery?.to) {
      // Use explicit delivery config
      channel = job.delivery.channel;
      to = job.delivery.to;
      actualMessage = text;
    } else {
      // Try to parse from message format: "channel:chat_id:message"
      const parts = text.split(':');
      const hasAtLeastThreeParts = parts.length >= 3;
      
      // Check if first part looks like a known channel
      const knownChannels = ['telegram', 'whatsapp', 'cli', 'gateway'];
      const firstPartIsChannel = knownChannels.includes(parts[0]);
      
      if (hasAtLeastThreeParts && firstPartIsChannel) {
        channel = parts[0];
        to = parts[1];
        actualMessage = parts.slice(2).join(':');
        log.info(
          { jobId: job.id, channel, to, parsedFrom: 'message', originalLength: text.length },
          'Parsed delivery from message format'
        );
      } else {
        // Fallback to defaults
        channel = 'cli';
        to = 'cron';
        actualMessage = text;
        log.debug(
          { jobId: job.id, partsCount: parts.length, firstPart: parts[0], hasDelivery: !!job.delivery },
          'Using default delivery - message format not recognized'
        );
      }
    }

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

      // Publish to message bus (send to channel)
      await this.messageBus.publishOutbound({
        channel,
        chat_id: to,
        content: actualMessage,
        type: 'message',
      });

      log.info(
        { jobId: job.id, channel, to, messageLength: actualMessage.length },
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
    // Get message from payload or fallback to job message
    const message = job.payload?.kind === 'agentTurn'
      ? job.payload.message
      : job.message;

    if (!message || !message.trim()) {
      return { status: 'skipped', error: 'Isolated job requires non-empty message' };
    }

    // Create session key for this cron job
    const sessionKey = `cron:${job.id}`;

    // Get model override if specified
    const model = job.model || (job.payload?.kind === 'agentTurn' ? job.payload.model : undefined);

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

      // Call agent service
      const response = await this.agentService.processDirect(message, sessionKey);

      log.info(
        { jobId: job.id, sessionKey, responseLength: response.length },
        'Agent execution completed'
      );

      // Handle delivery
      const delivery = job.delivery;
      if (delivery && delivery.mode !== 'none' && delivery.to) {
        const targetChannel = delivery.channel || 'cli';
        const targetChatId = delivery.to;

        await this.messageBus.publishOutbound({
          channel: targetChannel,
          chat_id: targetChatId,
          content: response,
          type: 'message',
        });

        log.info(
          { jobId: job.id, channel: targetChannel, to: targetChatId },
          'Delivered agent response'
        );

        return {
          status: 'ok' as const,
          summary: response.slice(0, 200),
          sessionKey,
          model,
        };
      }

      // No delivery configured, return response as summary
      return {
        status: 'ok' as const,
        summary: response.slice(0, 200),
        sessionKey,
        model,
      };
    })();

    // Race against timeout
    return await Promise.race([executePromise, timeoutPromise]);
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
            summary: `Executed: ${job.message.slice(0, 100)}`,
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
