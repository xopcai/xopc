// Append-only JSONL run history per job (durable across restarts)
import { appendFile, mkdir, readFile, readdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { resolveCronRunsDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import type { CronRunHistoryRow, JobExecution } from './types.js';

const log = createLogger('CronRunLog');

const MAX_LINES_PER_FILE = 2000;
const TRIM_TO_LINES = 1500;

export class CronRunLogStore {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? resolveCronRunsDir();
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private jobFile(jobId: string): string {
    return join(this.dir, `${jobId}.jsonl`);
  }

  async appendCompleted(execution: JobExecution): Promise<void> {
    if (execution.status === 'running') {
      return;
    }
    try {
      await this.ensureDir();
      const line = `${JSON.stringify(execution)}\n`;
      await appendFile(this.jobFile(execution.jobId), line, 'utf8');
      await this.maybeTrimFile(execution.jobId);
    } catch (err) {
      log.error({ jobId: execution.jobId, err: err as Error }, 'Failed to persist cron run');
    }
  }

  private async maybeTrimFile(jobId: string): Promise<void> {
    const file = this.jobFile(jobId);
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      return;
    }
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length <= MAX_LINES_PER_FILE) {
      return;
    }
    const kept = lines.slice(-TRIM_TO_LINES);
    await writeFile(file, `${kept.join('\n')}\n`, 'utf8');
  }

  async readJobHistory(jobId: string, limit: number): Promise<JobExecution[]> {
    if (limit <= 0) {
      return [];
    }
    let content: string;
    try {
      content = await readFile(this.jobFile(jobId), 'utf8');
    } catch {
      return [];
    }
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const parsed: JobExecution[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as JobExecution);
      } catch {
        // skip bad line
      }
    }
    parsed.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return parsed.slice(0, limit);
  }

  /**
   * Latest runs across all jobs (disk only). Caller supplies job names for display.
   */
  async readAllRuns(limit: number, jobNames: Map<string, string | undefined>): Promise<CronRunHistoryRow[]> {
    if (limit <= 0) {
      return [];
    }
    let names: string[];
    try {
      await this.ensureDir();
      names = await readdir(this.dir);
    } catch {
      return [];
    }

    const rows: CronRunHistoryRow[] = [];
    for (const fname of names) {
      if (!fname.endsWith('.jsonl')) {
        continue;
      }
      const jobId = fname.slice(0, -'.jsonl'.length);
      let content: string;
      try {
        content = await readFile(join(this.dir, fname), 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as JobExecution;
          rows.push({
            ...e,
            jobName: jobNames.get(jobId) ?? jobNames.get(e.jobId),
          });
        } catch {
          // skip
        }
      }
    }

    rows.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return rows.slice(0, limit);
  }

  async deleteJobRuns(jobId: string): Promise<void> {
    try {
      await unlink(this.jobFile(jobId));
    } catch {
      // ignore missing
    }
  }
}
