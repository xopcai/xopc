/**
 * Port Availability Checker
 * 
 * Checks if a port is available for binding.
 */

import { createServer } from 'net';
import { createLogger } from '../utils/logger.js';

const log = createLogger('PortChecker');

/**
 * Check if a port is available for binding
 * 
 * @param port - Port number to check
 * @param host - Host to bind to (default: '0.0.0.0')
 * @returns Promise resolving to true if port is available
 */
export async function checkPortAvailable(port: number, host: string = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    
    // Prevent unhandled error events
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        log.debug({ port, host }, 'Port is already in use');
      } else if (err.code === 'EACCES') {
        log.debug({ port, host }, 'Port requires elevated privileges');
      } else {
        log.debug({ err, port, host }, 'Port check error');
      }
      server.close();
      resolve(false);
    });

    server.on('listening', () => {
      log.debug({ port, host }, 'Port is available');
      server.close(() => {
        resolve(true);
      });
    });

    // Set timeout to prevent hanging
    const timeout = setTimeout(() => {
      log.warn({ port, host }, 'Port check timed out');
      server.close();
      resolve(false);
    }, 3000);

    server.once('close', () => {
      clearTimeout(timeout);
    });

    server.listen(port, host);
  });
}

/**
 * Get process using a port (platform-specific)
 * 
 * @param port - Port number
 * @returns Promise resolving to PID or null if not found
 */
export async function getProcessUsingPort(port: number): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      // Windows: use netstat
      const { exec } = await import('child_process');
      return new Promise((resolve) => {
        exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
          if (error || !stdout) {
            resolve(null);
            return;
          }
          // Parse output to get PID (last column)
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            if (line.includes(`:${port}`)) {
              const parts = line.trim().split(/\s+/);
              const pid = parseInt(parts[parts.length - 1], 10);
              if (!isNaN(pid)) {
                resolve(pid);
                return;
              }
            }
          }
          resolve(null);
        });
      });
    } else {
      // Unix-like: use lsof or netstat
      const { exec } = await import('child_process');
      return new Promise((resolve) => {
        exec(`lsof -i :${port} -t 2>/dev/null`, (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve(null);
            return;
          }
          const pid = parseInt(stdout.trim(), 10);
          resolve(isNaN(pid) ? null : pid);
        });
      });
    }
  } catch (err) {
    log.error({ err, port }, 'Failed to get process using port');
    return null;
  }
}

/**
 * Format port conflict error message with helpful suggestions
 */
export function formatPortConflictError(port: number, host: string, pid?: number | null): string {
  let message = `Port ${port} is already in use on ${host}`;
  
  if (pid) {
    message += ` (PID: ${pid})`;
    
    if (pid === process.pid) {
      message += '\n\n💡 This port is used by the current process.';
    } else if (process.platform === 'win32') {
      message += `\n\n💡 To stop the process: taskkill /PID ${pid} /F`;
      message += `\n💡 Or use a different port: xopcbot gateway --port <port>`;
    } else {
      message += `\n\n💡 To stop the process: kill ${pid} or kill -9 ${pid}`;
      message += `\n💡 Or use a different port: xopcbot gateway --port <port>`;
    }
  } else {
    message += '\n\n💡 Try a different port: xopcbot gateway --port <port>';
    message += `\n💡 Find what's using the port:`;
    message += process.platform === 'win32'
      ? `\n     netstat -ano | findstr :${port}`
      : `\n     lsof -i :${port}`;
  }
  
  return message;
}
