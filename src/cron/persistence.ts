// Cron persistence layer with atomic writes and caching
import { readFile, access } from 'fs/promises';
import { writeTextAtomic } from '../infra/write-file-atomic.js';
import { createLogger } from '../utils/logger.js';
import type { JobData } from './types.js';
import { JobDataSchema } from './validation.js';

const log = createLogger('CronPersistence');

export interface JobsFile {
  jobs: JobData[];
  version: number;
}

const DEFAULT_JOBS_FILE: JobsFile = {
  jobs: [],
  version: 1,
};

export class CronPersistence {
  private filePath: string;
  private cache: JobsFile | null = null;
  private dirty = false;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs = 500; // Debounce saves

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Initialize the storage file
   */
  async initialize(): Promise<void> {
    try {
      await access(this.filePath);
      // File exists, load it
      await this.load();
    } catch {
      // File doesn't exist, create it
      await this.save(DEFAULT_JOBS_FILE);
      log.info({ path: this.filePath }, 'Created new jobs file');
    }
  }

  /**
   * Load jobs from disk (with caching)
   */
  async load(): Promise<JobsFile> {
    // Return cache if available
    if (this.cache) {
      return this.cache;
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const data = JSON.parse(content) as JobsFile;
      
      // Validate basic structure
      if (!data.jobs || !Array.isArray(data.jobs)) {
        log.warn({ path: this.filePath }, 'Cron jobs file invalid (missing jobs[]), resetting to empty');
        this.cache = DEFAULT_JOBS_FILE;
        return this.cache;
      }

      const valid: JobData[] = [];
      for (const j of data.jobs) {
        const r = JobDataSchema.safeParse(j);
        if (r.success) {
          valid.push(r.data as JobData);
        } else {
          log.warn(
            { jobId: (j as { id?: string }).id, issues: r.error.flatten() },
            'Dropped invalid cron job'
          );
        }
      }

      if (valid.length !== data.jobs.length) {
        data.jobs = valid;
        data.version = (data.version ?? 1) + 1;
        this.cache = data;
        await this.writeToDisk(data);
        this.dirty = false;
        log.info({ count: valid.length }, 'Persisted cron jobs after validation');
        return data;
      }

      this.cache = data;
      log.debug({ jobCount: data.jobs.length }, 'Loaded jobs from disk');
      return data;
    } catch (error) {
      const em = error instanceof Error ? error.message : String(error);
      log.error({ err: error, path: this.filePath, errorMessage: em }, `Failed to load cron jobs file: ${em}`);
      this.cache = DEFAULT_JOBS_FILE;
      return this.cache;
    }
  }

  /**
   * Save jobs to disk (debounced)
   */
  async save(data: JobsFile): Promise<void> {
    this.cache = data;
    this.markDirty();
  }

  /**
   * Force immediate save (sync to disk)
   */
  async flush(): Promise<void> {
    if (!this.dirty || !this.cache) {
      return;
    }

    // Clear any pending debounced save
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    await this.writeToDisk(this.cache);
    this.dirty = false;
  }

  /**
   * Get all jobs
   */
  async getJobs(): Promise<JobData[]> {
    const data = await this.load();
    return data.jobs;
  }

  /**
   * Get a single job by ID
   */
  async getJob(id: string): Promise<JobData | null> {
    const jobs = await this.getJobs();
    return jobs.find((j) => j.id === id) || null;
  }

  /**
   * Add a new job
   */
  async addJob(job: JobData): Promise<void> {
    const data = await this.load();
    data.jobs.push(job);
    data.version++;
    await this.save(data);
  }

  /**
   * Update an existing job
   */
  async updateJob(
    id: string,
    updates: Partial<JobData>,
    options?: { clearAgentId?: boolean; clearWorkingDirectory?: boolean },
  ): Promise<boolean> {
    const data = await this.load();
    const index = data.jobs.findIndex((j) => j.id === id);
    
    if (index === -1) return false;

    const merged: JobData = {
      ...data.jobs[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    if (options?.clearAgentId) {
      delete merged.agentId;
    }
    if (options?.clearWorkingDirectory) {
      delete merged.workingDirectory;
    }
    data.jobs[index] = merged;
    data.version++;
    await this.save(data);
    return true;
  }

  /**
   * Remove a job
   */
  async removeJob(id: string): Promise<boolean> {
    const data = await this.load();
    const initialLength = data.jobs.length;
    data.jobs = data.jobs.filter((j) => j.id !== id);
    
    if (data.jobs.length === initialLength) return false;

    data.version++;
    await this.save(data);
    return true;
  }

  /** Atomic write (fsync + rename) via shared helper. */
  private async writeToDisk(data: JobsFile): Promise<void> {
    await writeTextAtomic(this.filePath, JSON.stringify(data, null, 2));
    log.debug({ jobCount: data.jobs.length }, 'Jobs saved to disk');
  }

  /**
   * Mark cache as dirty and schedule debounced save
   */
  private markDirty(): void {
    this.dirty = true;

    // Debounce saves
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.flush().catch((err) => {
        const em = err instanceof Error ? err.message : String(err);
        log.error({ err, path: this.filePath, errorMessage: em }, `Failed to save cron jobs file: ${em}`);
      });
    }, this.debounceMs);
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cache = null;
    this.dirty = false;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
  }
}
