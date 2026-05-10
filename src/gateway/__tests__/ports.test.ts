import net from 'node:net';
import { describe, it, expect } from 'vitest';
import { parseLsofOutput, checkPortAvailable } from '../ports.js';

describe('Ports', () => {
  describe('parseLsofOutput', () => {
    it('should parse lsof output correctly', () => {
      const output = `p1234\ncnode\np5678\ncpython`;
      const result = parseLsofOutput(output);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ pid: 1234, command: 'node' });
      expect(result[1]).toEqual({ pid: 5678, command: 'python' });
    });

    it('should handle empty output', () => {
      const result = parseLsofOutput('');
      expect(result).toHaveLength(0);
    });

    it('should handle partial entries', () => {
      const output = `p1234\ncnode\np5678`;
      const result = parseLsofOutput(output);
      
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({ pid: 5678 });
    });
  });

  describe('checkPortAvailable', () => {
    it('should return true for available port', async () => {
      const server = net.createServer();
      const port = await new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '0.0.0.0', () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            resolve(addr.port);
          } else {
            reject(new Error('expected socket address with port'));
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      const available = await checkPortAvailable(port);
      expect(available).toBe(true);
    });
  });
});
