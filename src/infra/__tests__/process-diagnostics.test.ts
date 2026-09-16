import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createProcessDiagnosticWriter } from '../process-diagnostics.js';

const roots: string[] = [];
function tempPath() {
  const root = mkdtempSync(join(tmpdir(), 'xopc-diagnostics-'));
  roots.push(root);
  return join(root, 'gateway.log');
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('process diagnostics', () => {
  it('writes bounded, redacted records and rotates to at most three files', () => {
    const path = tempPath();
    const write = createProcessDiagnosticWriter(path);
    const secret = 'sk-supersecret1234567890';
    write('test', `Authorization: Bearer ${secret}`);
    write('structured', { token: 'short-secret', error: new Error('audit failed') });
    expect(readFileSync(path, 'utf8')).not.toContain('short-secret');
    expect(readFileSync(path, 'utf8')).toContain('audit failed');
    expect(readFileSync(path, 'utf8')).not.toContain(secret);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    for (let i = 0; i < 110; i++) write('large', 'x'.repeat(100_000));
    expect(readdirSync(roots[0]!)).toEqual(expect.arrayContaining(['gateway.log', 'gateway.log.1', 'gateway.log.2']));
    expect(readdirSync(roots[0]!)).toHaveLength(3);
    for (const file of readdirSync(roots[0]!)) expect(statSync(join(roots[0]!, file)).size).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('does not throw when the diagnostic destination is unavailable', () => {
    const path = tempPath();
    writeFileSync(path, 'not a directory');
    expect(() => createProcessDiagnosticWriter(join(path, 'child.log'))('failure', new Error('original'))).not.toThrow();
  });

  it('persists an actual uncaught timer exception before the subprocess exits', () => {
    const path = tempPath();
    const modulePath = fileURLToPath(new URL('../process-diagnostics.ts', import.meta.url));
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { installProcessDiagnostics } from ${JSON.stringify(modulePath)};
      installProcessDiagnostics(${JSON.stringify(path)});
      setTimeout(() => { throw new Error('fatal-timer-test'); }, 1);
    `], { encoding: 'utf8', timeout: 15_000 });
    expect(child.status).toBe(1);
    const log = readFileSync(path, 'utf8');
    expect(log).toContain('uncaught_exception');
    expect(log).toContain('fatal-timer-test');
    expect(log).toContain('process_exit');
  });

  it('records non-SQLite unhandled rejections instead of silently swallowing them', () => {
    const path = tempPath();
    const diagnosticModule = fileURLToPath(new URL('../process-diagnostics.ts', import.meta.url));
    const rejectionModule = fileURLToPath(new URL('../unhandled-rejections.ts', import.meta.url));
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { installProcessDiagnostics } from ${JSON.stringify(diagnosticModule)};
      import { installSqliteTransientRejectionHandler } from ${JSON.stringify(rejectionModule)};
      installProcessDiagnostics(${JSON.stringify(path)});
      installSqliteTransientRejectionHandler();
      Promise.reject(new Error('background-rejection-test'));
      setTimeout(() => process.exit(0), 100);
    `], { encoding: 'utf8', timeout: 15_000 });
    expect(child.status).toBe(0);
    const log = readFileSync(path, 'utf8');
    expect(log).toContain('unhandled_rejection');
    expect(log).toContain('background-rejection-test');
  });

});
