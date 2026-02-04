import nodeCron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { CronJob } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CronService');

interface JobData {
  id: string;
  name?: string;
  schedule: string;
  message: string;
  enabled: boolean;
  created_at: string;
}

interface ScheduledTask {
  stop: () => void;
}

function getJobsPath(): string {
  return join(homedir(), '.xopcbot', 'cron-jobs.json');
}

function ensureJobsFile(): void {
  const path = getJobsPath();
  if (!existsSync(dirname(path))) {
    mkdirSync(dirname(path), { recursive: true });
  }
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify({ jobs: [] }, null, 2));
  }
}

function loadJobs(): { jobs: JobData[] } {
  ensureJobsFile();
  try {
    const content = readFileSync(getJobsPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return { jobs: [] };
  }
}

function saveJobs(data: { jobs: JobData[] }): void {
  ensureJobsFile();
  writeFileSync(getJobsPath(), JSON.stringify(data, null, 2));
}

export class CronService {
  private tasks: Map<string, ScheduledTask> = new Map();

  async addJob(
    schedule: string,
    message: string,
    name?: string
  ): Promise<{ id: string; schedule: string }> {
    // Validate cron expression
    if (!nodeCron.validate(schedule)) {
      throw new Error(`Invalid cron expression: ${schedule}`);
    }

    const id = uuidv4().slice(0, 8);
    const job: JobData = {
      id,
      name,
      schedule,
      message,
      enabled: true,
      created_at: new Date().toISOString(),
    };

    // Save to file
    const data = loadJobs();
    data.jobs.push(job);
    saveJobs(data);

    // Schedule the job
    this.scheduleJob(id, schedule, message);

    return { id, schedule };
  }

  private scheduleJob(id: string, schedule: string, message: string): void {
    // Cancel existing if any
    this.cancelJob(id);

    const task = nodeCron.schedule(schedule, () => {
      log.info({ jobId: id, message }, `Job triggered`);
      // The actual message sending is handled by the gateway
    });

    this.tasks.set(id, task);
  }

  listJobs(): Array<Omit<JobData, 'created_at'> & { enabled: boolean; next_run?: string }> {
    const data = loadJobs();
    
    return data.jobs.map(job => {
      let nextRun: string | undefined;
      try {
        const interval = CronExpressionParser.parse(job.schedule);
        nextRun = interval.next().toISOString();
      } catch {
        // Invalid cron expression
      }

      return {
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        message: job.message,
        enabled: job.enabled,
        next_run: nextRun,
      };
    });
  }

  getJob(id: string): JobData | null {
    const data = loadJobs();
    return data.jobs.find(j => j.id === id) || null;
  }

  async removeJob(id: string): Promise<boolean> {
    // Cancel task
    this.cancelJob(id);

    // Remove from file
    const data = loadJobs();
    const index = data.jobs.findIndex(j => j.id === id);
    if (index === -1) return false;

    data.jobs.splice(index, 1);
    saveJobs(data);

    return true;
  }

  async toggleJob(id: string, enabled: boolean): Promise<boolean> {
    const data = loadJobs();
    const job = data.jobs.find(j => j.id === id);
    if (!job) return false;

    job.enabled = enabled;
    saveJobs(data);

    if (enabled) {
      this.scheduleJob(id, job.schedule, job.message);
    } else {
      this.cancelJob(id);
    }

    return true;
  }

  private cancelJob(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.stop();
      this.tasks.delete(id);
    }
  }

  loadAllJobs(): void {
    const data = loadJobs();
    
    for (const job of data.jobs) {
      if (job.enabled) {
        this.scheduleJob(job.id, job.schedule, job.message);
      }
    }

    log.info({ count: this.tasks.size }, `Loaded jobs`);
  }

  stopAll(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
    log.info(`Stopped all jobs`);
  }

  getRunningCount(): number {
    return this.tasks.size;
  }
}
