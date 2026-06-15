// Durable cron run history in SQLite (`cron_runs` table).
import { createLogger } from '../utils/logger.js';
import {
  appendCronRun,
  deleteCronRunsForJob,
  isXopcDatabaseOpen,
  openXopcDatabase,
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

  private ensureDatabase(): void {
    if (!isXopcDatabaseOpen()) {
      openXopcDatabase(this.dbPath ? { path: this.dbPath } : undefined);
    }
  }

  async appendCompleted(execution: JobExecution): Promise<void> {
    if (execution.status === 'running') {
      return;
    }
    try {
      this.ensureDatabase();
      appendCronRun(execution);
    } catch (err) {
      log.error({ jobId: execution.jobId, err: err as Error }, 'Failed to persist cron run');
    }
  }

  async readJobHistory(jobId: string, limit: number): Promise<JobExecution[]> {
    this.ensureDatabase();
    return readCronJobHistory(jobId, limit);
  }

  async readAllRuns(limit: number, jobNames: Map<string, string | undefined>): Promise<CronRunHistoryRow[]> {
    this.ensureDatabase();
    const rows = readAllCronRuns(limit);
    return rows.map((execution) => ({
      ...execution,
      jobName: jobNames.get(execution.jobId),
    }));
  }

  async deleteJobRuns(jobId: string): Promise<void> {
    try {
      this.ensureDatabase();
      deleteCronRunsForJob(jobId);
    } catch (err) {
      log.warn({ jobId, err: err as Error }, 'Failed to delete cron runs');
    }
  }
}
