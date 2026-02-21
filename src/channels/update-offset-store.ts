/**
 * Update Offset Store for Telegram Polling
 * 
 * Persists last processed update ID to avoid duplicate message processing
 * Inspired by openclaw's update-offset-store.ts
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createLogger } from '../utils/logger.js';

const log = createLogger('UpdateOffsetStore');

const OFFSET_STORE_DIR = join(homedir(), '.xopcbot', 'state');
const OFFSET_STORE_FILE = 'telegram-offsets.json';

interface OffsetStoreData {
  offsets: Record<string, number>;
  lastUpdated: number;
}

/**
 * Get path to offset store file
 */
function getOffsetStorePath(): string {
  return join(OFFSET_STORE_DIR, OFFSET_STORE_FILE);
}

/**
 * Ensure offset store directory exists
 */
async function ensureStoreDir(): Promise<void> {
  await fs.mkdir(OFFSET_STORE_DIR, { recursive: true });
}

/**
 * Load offset store from disk
 */
async function loadOffsetStore(): Promise<OffsetStoreData> {
  try {
    const filePath = getOffsetStorePath();
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as OffsetStoreData;
    return {
      offsets: data.offsets ?? {},
      lastUpdated: data.lastUpdated ?? Date.now(),
    };
  } catch {
    // File doesn't exist or is corrupted, return empty store
    return {
      offsets: {},
      lastUpdated: Date.now(),
    };
  }
}

/**
 * Save offset store to disk
 */
async function saveOffsetStore(data: OffsetStoreData): Promise<void> {
  try {
    await ensureStoreDir();
    const filePath = getOffsetStorePath();
    const content = JSON.stringify(
      {
        ...data,
        lastUpdated: Date.now(),
      },
      null,
      2
    );
    await fs.writeFile(filePath, content, 'utf-8');
  } catch (err) {
    log.error({ err }, 'Failed to save offset store');
  }
}

/**
 * Read update offset for an account
 */
export async function readUpdateOffset(accountId: string): Promise<number | null> {
  try {
    const store = await loadOffsetStore();
    const offset = store.offsets[accountId];
    return typeof offset === 'number' ? offset : null;
  } catch (err) {
    log.error({ err, accountId }, 'Failed to read update offset');
    return null;
  }
}

/**
 * Write update offset for an account
 */
export async function writeUpdateOffset(
  accountId: string,
  offset: number
): Promise<void> {
  try {
    const store = await loadOffsetStore();
    
    // Only update if offset is greater than current
    const currentOffset = store.offsets[accountId] ?? 0;
    if (offset <= currentOffset) {
      return;
    }
    
    store.offsets[accountId] = offset;
    await saveOffsetStore(store);
    
    log.debug({ accountId, offset }, 'Update offset persisted');
  } catch (err) {
    log.error({ err, accountId, offset }, 'Failed to write update offset');
  }
}

/**
 * Clear update offset for an account
 */
export async function clearUpdateOffset(accountId: string): Promise<void> {
  try {
    const store = await loadOffsetStore();
    delete store.offsets[accountId];
    await saveOffsetStore(store);
    
    log.debug({ accountId }, 'Update offset cleared');
  } catch (err) {
    log.error({ err, accountId }, 'Failed to clear update offset');
  }
}

/**
 * Get all account offsets
 */
export async function getAllOffsets(): Promise<Record<string, number>> {
  const store = await loadOffsetStore();
  return { ...store.offsets };
}

/**
 * In-memory cache for offset store (reduces disk I/O)
 */
class OffsetStoreCache {
  private cache: Map<string, number> = new Map();
  private lastSync: number = 0;
  private syncInterval: number = 5000; // 5 seconds

  async get(accountId: string): Promise<number | null> {
    // Check cache first
    if (this.cache.has(accountId)) {
      return this.cache.get(accountId)!;
    }
    
    // Sync from disk if cache miss
    await this.syncFromDisk();
    return this.cache.get(accountId) ?? null;
  }

  async set(accountId: string, offset: number): Promise<void> {
    const current = this.cache.get(accountId) ?? 0;
    if (offset <= current) {
      return;
    }
    
    this.cache.set(accountId, offset);
    
    // Debounced write to disk
    const now = Date.now();
    if (now - this.lastSync > this.syncInterval) {
      await this.syncToDisk();
    }
  }

  private async syncFromDisk(): Promise<void> {
    const store = await loadOffsetStore();
    this.cache = new Map(Object.entries(store.offsets));
    this.lastSync = Date.now();
  }

  private async syncToDisk(): Promise<void> {
    const offsets = Object.fromEntries(this.cache);
    await saveOffsetStore({
      offsets,
      lastUpdated: Date.now(),
    });
    this.lastSync = Date.now();
  }

  async flush(): Promise<void> {
    await this.syncToDisk();
  }
}

// Export singleton instance for use across the application
export const offsetStoreCache = new OffsetStoreCache();
