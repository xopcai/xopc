import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { acquireGatewayLock, GatewayLockError } from '../lock.js';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TEST_CONFIG_PATH = join(homedir(), '.xopcbot', 'test-config.json');
const LOCKS_DIR = join(homedir(), '.xopcbot', 'locks');

describe('GatewayLock', () => {
  beforeEach(() => {
    // Clean up any existing test locks
    if (!existsSync(LOCKS_DIR)) {
      mkdirSync(LOCKS_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test locks
    try {
      const files = require('fs').readdirSync(LOCKS_DIR);
      for (const file of files) {
        if (file.includes('test')) {
          unlinkSync(join(LOCKS_DIR, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should acquire lock successfully', async () => {
    const lock = await acquireGatewayLock(TEST_CONFIG_PATH, { timeoutMs: 1000 });
    expect(lock).toBeDefined();
    expect(lock.lockPath).toBeDefined();
    expect(lock.configPath).toBe(TEST_CONFIG_PATH);
    expect(existsSync(lock.lockPath)).toBe(true);
    
    await lock.release();
    expect(existsSync(lock.lockPath)).toBe(false);
  });

  it('should throw error when lock is already held', async () => {
    const lock = await acquireGatewayLock(TEST_CONFIG_PATH, { timeoutMs: 1000 });
    
    try {
      await expect(
        acquireGatewayLock(TEST_CONFIG_PATH, { timeoutMs: 500 })
      ).rejects.toThrow(GatewayLockError);
    } finally {
      await lock.release();
    }
  });

  it('should allow re-acquiring lock after release', async () => {
    const lock1 = await acquireGatewayLock(TEST_CONFIG_PATH, { timeoutMs: 1000 });
    await lock1.release();
    
    const lock2 = await acquireGatewayLock(TEST_CONFIG_PATH, { timeoutMs: 1000 });
    expect(lock2).toBeDefined();
    await lock2.release();
  });
});
