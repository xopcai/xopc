import net from 'node:net';
import { describe, it, expect } from 'vitest';
import { parseLsofOutput, parseNetstatOutput, checkPortAvailable } from '../ports.js';

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

  describe('parseNetstatOutput', () => {
    it('should parse typical netstat -ano output', () => {
      const output = [
        '',
        'Active Connections',
        '',
        '  Proto  Local Address          Foreign Address        State           PID',
        '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012',
        '  TCP    0.0.0.0:18790          0.0.0.0:0              LISTENING       5678',
        '  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4',
        '  TCP    127.0.0.1:18790        0.0.0.0:0              LISTENING       5678',
        '  TCP    192.168.1.5:18790      0.0.0.0:0              LISTENING       9999',
        '  TCP    0.0.0.0:49152          0.0.0.0:0              LISTENING       600',
        '',
      ].join('\r\n');

      const result = parseNetstatOutput(output, 18790);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ pid: 5678 });
      expect(result[1]).toEqual({ pid: 9999 });
    });

    it('should return empty for no matching port', () => {
      const output = '  TCP    0.0.0.0:8080          0.0.0.0:0              LISTENING       1234\r\n';
      const result = parseNetstatOutput(output, 18790);
      expect(result).toHaveLength(0);
    });

    it('should not match non-LISTENING states', () => {
      const output = '  TCP    0.0.0.0:18790         0.0.0.0:0              ESTABLISHED     1234\r\n';
      const result = parseNetstatOutput(output, 18790);
      expect(result).toHaveLength(0);
    });

    it('should handle empty output', () => {
      expect(parseNetstatOutput('', 18790)).toHaveLength(0);
    });

    it('should deduplicate PIDs across addresses', () => {
      const output = [
        '  TCP    0.0.0.0:18790          0.0.0.0:0              LISTENING       5678',
        '  TCP    [::]:18790             [::]:0                 LISTENING       5678',
      ].join('\r\n');

      const result = parseNetstatOutput(output, 18790);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ pid: 5678 });
    });

    it('should not match port as substring of longer port', () => {
      const output = '  TCP    0.0.0.0:187900        0.0.0.0:0              LISTENING       1234\r\n';
      // Port suffix match: ":18790" would match ":187900" — but ":18790" !== ":187900"
      const result = parseNetstatOutput(output, 18790);
      expect(result).toHaveLength(0);
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
