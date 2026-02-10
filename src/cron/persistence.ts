// Cron persistence layer with atomic writes and caching
import {
  readFile,
  writeFile,
  mkdir,
  access,
  rename,
  unlink,
} from 'fs/promises';
import { dirname } from 'path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CronPersistence');

export interface JobData {
  id: string;
  name?: string;
  schedule: string;
  message: string;
  enabled: boolean;
  timezone?: string;
  maxRetries: number;
  timeout: number;
  created_at: string;
  updated_at: string;
}

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
        log.warn('Invalid jobs file structure, resetting');
        this.cache = DEFAULT_JOBS_FILE;
        return this.cache;
      }

      this.cache = data;
      log.debug({ jobCount: data.jobs.length }, 'Loaded jobs from disk');
      return data;
    } catch (error) {
      log.error({ err: error }, 'Failed to load jobs, returning empty');
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
  async updateJob(id: string, updates: Partial<JobData>): Promise<boolean> {
    const data = await this.load();
    const index = data.jobs.findIndex((j) => j.id === id);
    
    if (index === -1) return false;

    data.jobs[index] = {
      ...data.jobs[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
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

  /**
   * Atomic write to disk (write to temp file, then rename)
   */
  private async writeToDisk(data: JobsFile): Promise<void> {
    const tempPath = `${this.filePath}.tmp.${Date.now()}`;
    
    try {
      // Ensure directory exists
      await mkdir(dirname(this.filePath), { recursive: true });
      
      // Write to temp file
      await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      
      // Atomic rename
      await rename(tempPath, this.filePath);
      
      log.debug({ jobCount: data.jobs.length }, 'Jobs saved to disk');
    } catch (error) {
      // Clean up temp file on error
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
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
        log.error({ err }, 'Failed to save jobs');
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
