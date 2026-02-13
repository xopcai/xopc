// CronService - Optimized with async I/O, caching, and execution tracking
import nodeCron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_PATHS, Config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { CronPersistence } from './persistence.js';
import { DefaultJobExecutor } from './executor.js';
import { z } from 'zod';
import { AddJobRequestSchema, UpdateJobRequestSchema } from './validation.js';
import type {
  JobData,
  JobExecution,
  JobExecutor,
  CronMetrics,
  CronHealth,
  AddJobOptions,
  JobWithNextRun,
} from './types.js';

const log = createLogger('CronService');

interface ScheduledTask {
  stop: () => void;
}

export class CronService {
  private persistence: CronPersistence;
  private executor: JobExecutor;
  private tasks: Map<string, ScheduledTask> = new Map();
  private initialized = false;

  constructor(
    filePath: string = DEFAULT_PATHS.cronJobs,
    executor?: JobExecutor
  ) {
    this.persistence = new CronPersistence(filePath);
    this.executor = executor || new DefaultJobExecutor();
  }

  /**
   * Initialize the service and load all jobs
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.persistence.initialize();
    await this.loadAllJobs();
    
    this.initialized = true;
    log.info('CronService initialized');
  }

  /**
   * Add a new job
   */
  async addJob(
    schedule: string,
    message: string,
    options?: AddJobOptions
  ): Promise<{ id: string; schedule: string }> {
    // Validate input
    const validationResult = AddJobRequestSchema.safeParse({
      schedule,
      message,
      ...options,
    });

    if (!validationResult.success) {
      const errorMsg = (validationResult as { error?: { errors: z.ZodIssue[] } }).error?.errors.map((e) => e.message).join(', ') || 'Unknown validation error';
      throw new Error(`Validation failed: ${errorMsg}`);
    }

    const id = uuidv4().slice(0, 8);
    const now = new Date().toISOString();
    
    const job: JobData = {
      id,
      name: options?.name,
      schedule,
      message,
      enabled: true,
      timezone: options?.timezone,
      maxRetries: options?.maxRetries ?? 3,
      timeout: options?.timeout ?? 60000,
      created_at: now,
      updated_at: now,
    };

    // Save to persistence
    await this.persistence.addJob(job);

    // Schedule the job
    this.scheduleJob(job);

    log.info({ jobId: id, name: options?.name }, 'Job added');
    return { id, schedule };
  }

  /**
   * List all jobs with next run time
   */
  async listJobs(): Promise<JobWithNextRun[]> {
    const jobs = await this.persistence.getJobs();

    return jobs.map((job) => {
      let nextRun: string | undefined;
      
      if (job.enabled) {
        try {
          const options = job.timezone ? { tz: job.timezone } : undefined;
          const interval = CronExpressionParser.parse(job.schedule, options);
          nextRun = interval.next().toISOString();
        } catch (err) {
          log.debug({ jobId: job.id, err: err as Error }, 'Failed to parse cron for next run');
        }
      }

      return {
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        message: job.message,
        enabled: job.enabled,
        timezone: job.timezone,
        maxRetries: job.maxRetries,
        timeout: job.timeout,
        next_run: nextRun,
      };
    });
  }

  /**
   * Get a single job
   */
  async getJob(id: string): Promise<JobData | null> {
    return this.persistence.getJob(id);
  }

  /**
   * Update a job
   */
  async updateJob(id: string, updates: Partial<Omit<JobData, 'id' | 'created_at' | 'updated_at'>>): Promise<boolean> {
    // Validate updates
    const validationResult = UpdateJobRequestSchema.safeParse(updates);
    if (!validationResult.success) {
      const errorMsg = (validationResult as { error?: { errors: z.ZodIssue[] } }).error?.errors.map((e) => e.message).join(', ') || 'Unknown validation error';
      throw new Error(`Validation failed: ${errorMsg}`);
    }

    const job = await this.persistence.getJob(id);
    if (!job) return false;

    // Cancel existing task if schedule changes
    if (updates.schedule && updates.schedule !== job.schedule) {
      this.cancelTask(id);
    }

    // Update persistence
    await this.persistence.updateJob(id, updates);

    // Re-schedule if needed
    const updated = await this.persistence.getJob(id);
    if (updated && updated.enabled) {
      this.scheduleJob(updated);
    }

    log.info({ jobId: id }, 'Job updated');
    return true;
  }

  /**
   * Remove a job
   */
  async removeJob(id: string): Promise<boolean> {
    // Cancel task
    this.cancelTask(id);

    // Remove from persistence
    const removed = await this.persistence.removeJob(id);
    
    if (removed) {
      log.info({ jobId: id }, 'Job removed');
    }
    
    return removed;
  }

  /**
   * Toggle job enabled state
   */
  async toggleJob(id: string, enabled: boolean): Promise<boolean> {
    const job = await this.persistence.getJob(id);
    if (!job) return false;

    await this.persistence.updateJob(id, { enabled });

    if (enabled) {
      const updated = await this.persistence.getJob(id);
      if (updated) this.scheduleJob(updated);
    } else {
      this.cancelTask(id);
    }

    log.info({ jobId: id, enabled }, 'Job toggled');
    return true;
  }

  /**
   * Get execution history for a job
   */
  getJobHistory(jobId: string, limit?: number): JobExecution[] {
    if (this.executor instanceof DefaultJobExecutor) {
      return this.executor.getHistory(jobId, limit);
    }
    return [];
  }

  /**
   * Get service metrics
   */
  async getMetrics(): Promise<CronMetrics> {
    const jobs = await this.persistence.getJobs();
    const enabled = jobs.filter((j) => j.enabled);

    let nextScheduledJob: CronMetrics['nextScheduledJob'] | undefined;
    
    for (const job of enabled) {
      try {
        const options = job.timezone ? { tz: job.timezone } : undefined;
        const interval = CronExpressionParser.parse(job.schedule, options);
        const next = interval.next();
        
        if (!nextScheduledJob || next.getTime() < nextScheduledJob.runAt.getTime()) {
          nextScheduledJob = {
            id: job.id,
            name: job.name,
            runAt: next.toDate(),
          };
        }
      } catch {
        // Skip invalid schedules
      }
    }

    return {
      totalJobs: jobs.length,
      runningJobs: this.tasks.size,
      enabledJobs: enabled.length,
      failedLastHour: 0, // TODO: track from executor
      avgExecutionTime: 0, // TODO: track from executor
      nextScheduledJob,
    };
  }

  /**
   * Update config (hot reload)
   */
  updateConfig(_config: Config): void {
    // Cron jobs are managed separately via addJob/removeJob
    // This method exists for interface compatibility
    log.debug('Cron config updated (jobs managed separately)');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<CronHealth> {
    const issues: string[] = [];

    // Check if initialized
    if (!this.initialized) {
      issues.push('Service not initialized');
    }

    // Check for jobs with invalid schedules
    const jobs = await this.persistence.getJobs();
    for (const job of jobs) {
      if (!nodeCron.validate(job.schedule)) {
        issues.push(`Job ${job.id} has invalid schedule`);
      }
    }

    // Determine status
    let status: CronHealth['status'] = 'healthy';
    if (issues.length > 0) {
      status = issues.length > 5 ? 'unhealthy' : 'degraded';
    }

    return { status, issues };
  }

  /**
   * Run a job immediately (manual trigger)
   */
  async runJobNow(id: string): Promise<void> {
    const job = await this.persistence.getJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    if (!job.enabled) throw new Error(`Job is disabled: ${id}`);

    await this.executeJob(job);
  }

  /**
   * Stop all jobs and cleanup
   */
  async stop(options?: { waitForRunning?: boolean; timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 30000;

    // Cancel all scheduled tasks
    for (const [id, task] of this.tasks) {
      task.stop();
      
      // Cancel running executions
      if (this.executor instanceof DefaultJobExecutor) {
        this.executor.cancelJob(id);
      }
    }
    this.tasks.clear();

    // Wait for running jobs if requested
    if (options?.waitForRunning && this.executor instanceof DefaultJobExecutor) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const running = this.executor.getRunningExecutions();
        if (running.length === 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Flush any pending writes
    await this.persistence.flush();

    log.info('CronService stopped');
  }

  /**
   * Load and schedule all enabled jobs
   */
  private async loadAllJobs(): Promise<void> {
    const jobs = await this.persistence.getJobs();

    for (const job of jobs) {
      if (job.enabled) {
        this.scheduleJob(job);
      }
    }

    log.info({ count: this.tasks.size }, 'Jobs loaded');
  }

  /**
   * Schedule a job with node-cron
   */
  private scheduleJob(job: JobData): void {
    // Cancel existing if any
    this.cancelTask(job.id);

    // Validate schedule
    if (!nodeCron.validate(job.schedule)) {
      log.error({ jobId: job.id, schedule: job.schedule }, 'Invalid cron expression');
      return;
    }

    const options = job.timezone ? { timezone: job.timezone } : undefined;
    
    const task = nodeCron.schedule(
      job.schedule,
      async () => {
        await this.executeJob(job);
      },
      options
    );

    this.tasks.set(job.id, task);
    log.debug({ jobId: job.id, schedule: job.schedule }, 'Job scheduled');
  }

  /**
   * Execute a job with retry logic
   */
  private async executeJob(job: JobData): Promise<void> {
    // Prevent overlapping executions
    if (this.executor instanceof DefaultJobExecutor && this.executor.isRunning(job.id)) {
      log.warn({ jobId: job.id }, 'Job already running, skipping');
      return;
    }

    const controller = new AbortController();
    
    try {
      await this.executor.execute(job, controller.signal);
    } catch (error) {
      log.error({ jobId: job.id, err: error as Error }, 'Job execution failed');
      // Retry logic is handled by the executor
    }
  }

  /**
   * Cancel a scheduled task
   */
  private cancelTask(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.stop();
      this.tasks.delete(id);
      log.debug({ jobId: id }, 'Task cancelled');
    }
  }
}
