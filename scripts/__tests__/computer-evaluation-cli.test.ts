import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const cli = (script: string, ...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', `scripts/${script}.mts`, ...args],
  { encoding: 'utf8', timeout: 15_000, env: { ...process.env, XOPC_LOG_LEVEL: 'fatal' } });

describe('computer evaluation CLI process boundary', () => {
  function fixture(crash = false) {
    const root = mkdtempSync(join(tmpdir(), 'xopc-computer-evaluation-')); roots.push(root);
    const executor = join(root, 'executor.mjs'), oracle = join(root, 'oracle.mjs');
    const manifestPath = join(root, 'manifest.json'), output = join(root, 'report.json');
    writeFileSync(executor, crash ? 'console.error("private credential in stderr"); process.exit(2);' : `
      let input='';for await (const chunk of process.stdin) input+=chunk;
      const request=JSON.parse(input);
      console.log(JSON.stringify({runId:request.taskId,claimedSuccess:true,takeover:false,duplicateInputs:0,scopeViolations:0,
        postStopInputs:0,durationMs:10,modelRequests:1,inputTokens:10,outputTokens:2,cost:null,actions:1,unchangedInputs:0}));`);
    writeFileSync(oracle, `let input='';for await (const chunk of process.stdin) input+=chunk;
      const request=JSON.parse(input);console.log(JSON.stringify({outcome:'passed',oracle:'application-state',evidenceRef:request.taskId+'.json'}));`);
    writeFileSync(manifestPath, JSON.stringify({ plan: { taskIds: ['a', 'b'], repetitions: 1, modelRef: 'fixture/model',
      environment: 'fixed', evidence: 'fixture' }, executor: { command: [process.execPath, executor] }, oracle: { command: [process.execPath, oracle] } }));
    return { root, manifestPath, output };
  }
  it('runs real executor and oracle processes, checkpoints private reports and compares the resulting matrix', () => {
    const f = fixture();
    const result = cli('run-computer-evaluation', f.manifestPath, f.output);
    expect(result.status, result.stderr).toBe(1); // Fixture evidence must not certify a release.
    const report = JSON.parse(readFileSync(f.output, 'utf8'));
    expect(report).toMatchObject({ interrupted: false, summary: { passed: 2, completedRuns: 2, betaGatePassed: false, actions: 2 } });
    if (process.platform !== 'win32') expect(statSync(f.output).mode & 0o777).toBe(0o600);
    const compared = cli('compare-computer-evaluations', f.output, f.output);
    expect(compared.status, compared.stderr).toBe(0);
    expect(JSON.parse(compared.stdout)).toMatchObject({ complete: true, pairedRuns: 2, ties: 2, metrics: { durationMs: { deltaMean: 0 } } });
  });
  it('persists a real process failure and missing denominator without leaking stderr or claiming safe inputs', () => {
    const f = fixture(true);
    const result = cli('run-computer-evaluation', f.manifestPath, f.output);
    expect(result.status).toBe(1);
    const text = readFileSync(f.output, 'utf8');
    expect(text + result.stdout + result.stderr).not.toContain('private credential');
    expect(JSON.parse(text)).toMatchObject({ interrupted: true, runs: [{ duplicateInputs: null, modelRequests: null,
      failure: { phase: 'executor', category: 'harness', dispatch: 'unknown' } }],
      summary: { completedRuns: 1, missingRuns: 1, successRate: 0, unmeasuredSafetyRuns: 1 } });
    expect(cli('compare-computer-evaluations', f.output, f.output).status).toBe(1);
  });
  it.skipIf(process.platform === 'win32')('terminates the active executor on SIGTERM and saves an interrupted checkpoint without replay', async () => {
    const f = fixture();
    const ready = join(f.root, 'ready');
    writeFileSync(join(f.root, 'executor.mjs'), `import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(()=>{},1000);`);
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/run-computer-evaluation.mts', f.manifestPath, f.output],
      { stdio: 'ignore', env: { ...process.env, XOPC_LOG_LEVEL: 'fatal' } });
    const finished = new Promise<number | null>(resolve => child.once('close', resolve));
    let pid: number | undefined;
    try {
      await vi.waitFor(() => expect(existsSync(ready)).toBe(true), { timeout: 10_000 });
      pid = Number(readFileSync(ready, 'utf8'));
      child.kill('SIGTERM');
      await vi.waitFor(() => expect(child.exitCode).not.toBeNull(), { timeout: 5000 });
      expect(await finished).toBe(1);
      const report = JSON.parse(readFileSync(f.output, 'utf8'));
      expect(report).toMatchObject({ interrupted: true, runs: [], summary: { missingRuns: 2, successRate: 0 },
        interruption: { category: 'cancelled', dispatch: 'unknown' } });
      expect(() => process.kill(pid!, 0)).toThrow();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* The process has already exited. */ } }
      await finished;
    }
  }, 15_000);
});
