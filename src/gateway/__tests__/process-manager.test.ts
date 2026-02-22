/**
 * Gateway Process Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GatewayProcessManager } from '../process-manager.js';
import {
  writePidFile,
  readPidFile,
  removePidFile,
  processExists,
  isPidFileStale,
  cleanupStalePidFile,
} from '../pid-file.js';
import { checkPortAvailable } from '../port-checker.js';

describe('GatewayProcessManager', () => {
  let manager: GatewayProcessManager;

  beforeEach(() => {
    manager = new GatewayProcessManager();
    // Clean up any existing PID file
    removePidFile();
  });

  afterEach(() => {
    removePidFile();
  });

  describe('isRunning', () => {
    it('should return false when no PID file exists', () => {
      expect(manager.isRunning()).toBe(false);
    });

    it('should return false when PID file exists but process is gone', () => {
      // Write a fake PID
      writePidFile(99999);
      
      // Should detect it's not running
      expect(manager.isRunning()).toBe(false);
      
      // Clean up
      cleanupStalePidFile();
    });
  });

  describe('getStatus', () => {
    it('should return running: false when not running', () => {
      const status = manager.getStatus();
      expect(status.running).toBe(false);
    });
  });

  describe('start with port conflict', () => {
    it('should detect port in use', async () => {
      // Find an available port first
      let testPort = 18791;
      while (!(await checkPortAvailable(testPort))) {
        testPort++;
      }

      // Start a simple server to occupy the port
      const { createServer } = await import('net');
      const server = createServer();
      
      await new Promise<void>((resolve) => {
        server.listen(testPort, '0.0.0.0', () => {
          resolve();
        });
      });

      // Try to start gateway on the same port
      const result = await manager.start({
        host: '0.0.0.0',
        port: testPort,
        background: true,
      });

      expect(result.success).toBe(false);
      expect(result.portInUse).toBe(true);
      expect(result.error).toContain('Port');

      // Clean up
      server.close();
    });
  });
});

describe('PID File', () => {
  beforeEach(() => {
    removePidFile();
  });

  afterEach(() => {
    removePidFile();
  });

  it('should write and read PID file', () => {
    const testPid = 12345;
    writePidFile(testPid);
    expect(readPidFile()).toBe(testPid);
  });

  it('should return null when no PID file', () => {
    expect(readPidFile()).toBe(null);
  });

  it('should remove PID file', () => {
    writePidFile(12345);
    removePidFile();
    expect(readPidFile()).toBe(null);
  });

  it('should detect stale PID file', () => {
    // Write a fake PID that doesn't exist
    writePidFile(99999);
    expect(isPidFileStale()).toBe(true);
  });

  it('should clean up stale PID file', () => {
    writePidFile(99999);
    cleanupStalePidFile();
    expect(readPidFile()).toBe(null);
  });

  it('should handle invalid PID in file', async () => {
    const { writeFileSync } = await import('fs');
    const { getPidFilePath } = await import('../pid-file.js');
    
    writeFileSync(getPidFilePath(), 'invalid', 'utf-8');
    expect(readPidFile()).toBe(null);
  });
});

describe('processExists', () => {
  it('should return true for current process', () => {
    expect(processExists(process.pid)).toBe(true);
  });

  it('should return false for non-existent PID', () => {
    expect(processExists(99999)).toBe(false);
  });
});

describe('Port Checker', () => {
  it('should detect available port', async () => {
    // Find an available port
    let testPort = 18792;
    while (!(await checkPortAvailable(testPort))) {
      testPort++;
    }
    
    const available = await checkPortAvailable(testPort);
    expect(available).toBe(true);
  });

  it('should detect port in use', async () => {
    const { createServer } = await import('net');
    const server = createServer();
    
    // Find an available port and occupy it
    let testPort = 18793;
    while (!(await checkPortAvailable(testPort))) {
      testPort++;
    }
    
    await new Promise<void>((resolve) => {
      server.listen(testPort, '0.0.0.0', () => {
        resolve();
      });
    });

    // Should detect port is in use
    const available = await checkPortAvailable(testPort);
    expect(available).toBe(false);

    server.close();
  });
});
