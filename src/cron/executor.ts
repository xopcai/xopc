// Cron job executor with timeout and retry logic
import type { JobData, JobExecution, JobExecutor } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CronExecutor');

export class DefaultJobExecutor implements JobExecutor {
  private history: Map<string, JobExecution[]> = new Map();
  private runningJobs = new Map<string, AbortController>();

  async execute(job: JobData, signal: AbortSignal): Promise<void> {
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

    log.info({ jobId: job.id, executionId, message: job.message.slice(0, 100) }, 'Job executing');

    try {
      // Check for cancellation
      if (signal.aborted) {
        throw new Error('Job was cancelled before execution');
      }

      // Simulate job execution (replace with actual logic)
      await this.performJob(job, signal);

      // Mark as success
      execution.status = 'success';
      execution.endedAt = new Date().toISOString();
      execution.duration = Date.now() - new Date(execution.startedAt).getTime();

      log.info({ jobId: job.id, executionId, duration: execution.duration }, 'Job completed');
    } catch (error) {
      execution.status = 'failed';
      execution.endedAt = new Date().toISOString();
      execution.duration = Date.now() - new Date(execution.startedAt).getTime();
      execution.error = error instanceof Error ? error.message : String(error);

      log.error({ jobId: job.id, executionId, error: execution.error }, 'Job failed');
      throw error;
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  /**
   * Perform the actual job work
   * Override this method for custom execution logic
   */
  protected async performJob(job: JobData, signal: AbortSignal): Promise<void> {
    // Default implementation: just log and resolve
    // In real usage, this would send messages, run commands, etc.
    
    return new Promise((resolve, reject) => {
      const timeout = job.timeout || 60000;
      
      const timeoutId = setTimeout(() => {
        reject(new Error(`Job timed out after ${timeout}ms`));
      }, timeout);

      // Listen for abort signal
      signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(new Error('Job was aborted'));
      });

      // Simulate work
      setTimeout(() => {
        if (!signal.aborted) {
          clearTimeout(timeoutId);
          resolve();
        }
      }, 100); // Minimal delay for simulation
    });
  }

  /**
   * Cancel a running job
   */
  cancelJob(jobId: string): boolean {
    const _controller = this.runningJobs.get(jobId);
    if (_controller) {
      _controller.abort();
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
    for (const [jobId, _controller] of this.runningJobs) {
      // Find the running execution
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
