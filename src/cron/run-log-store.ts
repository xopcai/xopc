// Durable cron run history in SQLite (`cron_runs` table).
import { createLogger } from '../utils/logger.js';
import {
  appendCronRun,
  deleteCronRunsForJob,
  requireXopcDatabase,
  readAllCronRuns,
  readCronJobHistory,
} from '../storage/sqlite/index.js';
import type { CronRunHistoryRow, JobExecution } from './types.js';

const log = createLogger('CronRunLog');

export class CronRunLogStore {
  private readonly dbPath?: string;

  /** @param dbPath Optional SQLite path for tests (opens a dedicated DB). */
  constructor(dbPath?: string) {
    this.dbPath = dbPath;
  }

  private requireDatabase(): void {
    requireXopcDatabase(this.dbPath ? { path: this.dbPath } : undefined);
  }

  async upsert(execution: JobExecution): Promise<void> {
    try {
      this.requireDatabase();
      appendCronRun(execution);
    } catch (err) {
      log.error({ jobId: execution.jobId, err: err as Error }, 'Failed to persist cron run');
    }
  }

  async appendCompleted(execution: JobExecution): Promise<void> {
    await this.upsert(execution);
  }

  async readJobHistory(jobId: string, limit: number): Promise<JobExecution[]> {
    this.requireDatabase();
    return readCronJobHistory(jobId, limit);
  }

  async readAllRuns(limit: number, jobNames: Map<string, string | undefined>): Promise<CronRunHistoryRow[]> {
    this.requireDatabase();
    const rows = readAllCronRuns(limit);
    return rows.map((execution) => ({
      ...execution,
      jobName: jobNames.get(execution.jobId),
    }));
  }

  async deleteJobRuns(jobId: string): Promise<void> {
    try {
      this.requireDatabase();
      deleteCronRunsForJob(jobId);
    } catch (err) {
      log.warn({ jobId, err: err as Error }, 'Failed to delete cron runs');
    }
  }
}
