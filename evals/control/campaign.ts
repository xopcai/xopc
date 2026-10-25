import { setTimeout as delay } from 'node:timers/promises';
import { closeDeadRequestTails } from './terminal-audit.js';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { TaskScheduler, type ScheduleSnapshot } from '../coder/packages/runner/src/scheduler.js';
import { RequestPool, startPool, type PoolEndpoint } from './request-pool.js';
import { ControlStore } from './store.js';
import { array, record, type EvidenceSource, type Row } from './types.js';

export interface CampaignJob { id: string; args: string[]; dependsOn?: string[]; resource?: string; timeoutMs: number; evidence?: EvidenceSource[]; replaySafe?: boolean }
export interface CampaignPlan { id: string; concurrency: number; maxWallMs: number; maxRequests?: number; jobs: CampaignJob[]; modelOrigins?: string[]; pool?: { generation: number; judge: number; parent: number } }
export function validatePlan(value: unknown): CampaignPlan {
  const plan = record(value);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(plan.id)) || !Number.isInteger(plan.concurrency) || Number(plan.concurrency) < 1 || Number(plan.concurrency) > 16
    || !Number.isFinite(plan.maxWallMs) || Number(plan.maxWallMs) < 1000 || !array(plan.jobs).length) throw new Error('Invalid campaign identity or budget');
  if (array(plan.modelOrigins).length && (!Number.isInteger(plan.maxRequests) || Number(plan.maxRequests) < 1)) throw new Error('Instrumented model execution requires maxRequests');
  for (const origin of array(plan.modelOrigins)) if (typeof origin !== 'string' || new URL(origin).origin !== origin) throw new Error('modelOrigins must contain exact origins');
  const jobs = array(plan.jobs).map(v => record(v));
  const ids = new Set(jobs.map(j => j.id));
  if (ids.size !== jobs.length) throw new Error('Duplicate job id');
  const visited = new Set<unknown>(); const visiting = new Set<unknown>();
  const visit = (j: Row) => {
    if (visiting.has(j.id)) throw new Error('Cyclic campaign dependency');
    if (visited.has(j.id)) return;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(j.id)) || !array(j.args).length || array(j.args).some(a => typeof a !== 'string')
      || !Number.isFinite(j.timeoutMs) || Number(j.timeoutMs) < 1) throw new Error('Invalid job');
    visiting.add(j.id);
    for (const dep of array(j.dependsOn)) {
      const parent = jobs.find(v => v.id === dep); if (!parent) throw new Error('Unknown dependency'); visit(parent);
    }
    visiting.delete(j.id); visited.add(j.id);
  };
  jobs.forEach(visit);
  return value as CampaignPlan;
}
const atomic = (path: string, value: unknown) => { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); renameSync(path + '.tmp', path); };
function fingerprint(root: string): string {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'evals/control', 'evals/coder', 'scripts', 'src', 'packages', 'extensions', 'pnpm-lock.yaml', 'package.json'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean).sort();
  const sum = createHash('sha256');
  for (const name of names) { sum.update(name); try { sum.update(readFileSync(join(root, name))); } catch { sum.update('missing'); } }
  return sum.digest('hex');
}

export async function runCampaign(plan: CampaignPlan, root: string, output: string, store: ControlStore, resume = false, sharedEndpoint?: PoolEndpoint): Promise<Row> {
  const directory = resolve(output);
  const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  const sourceHash = fingerprint(root);
  let state: Row;
  if (resume) {
    state = record(JSON.parse(readFileSync(join(directory, 'campaign.json'), 'utf8')));
    if (state.planHash !== planHash || state.sourceHash !== sourceHash) throw new Error('Resume requires identical plan and source fingerprint');
    if (['running', 'paused'].includes(String(state.status))) throw new Error('Stop the original owner before resuming');
    if (Number(record(state.pool).active ?? 0) > 0) throw new Error('Previous request leases require external-state reconciliation');
  } else {
    mkdirSync(directory, { recursive: false, mode: 0o700 });
    state = { id: plan.id, planHash, sourceHash, startedAt: new Date().toISOString(), jobs: {}, output: directory,
      plan: plan.jobs.map(j => ({ id: j.id, dependsOn: j.dependsOn ?? [], timeoutMs: j.timeoutMs })),
      budget: { maxWallMs: plan.maxWallMs }, expectedJobs: plan.jobs.length };
  }
  const campaignId = `${plan.id}-${planHash.slice(0, 8)}-${createHash('sha256').update(directory).digest('hex').slice(0, 8)}`;
  const jobs = record(state.jobs);
  if (resume && plan.jobs.some(job => record(jobs[job.id]).status === 'interrupted' && !job.replaySafe)) {
    throw new Error('Interrupted jobs require explicit replaySafe and reconciled external state before resume');
  }
  const priorElapsed = Number(state.elapsedMs ?? 0);
  const admittedBefore = Number(state.admittedRequests ?? record(state.pool).admitted ?? 0);
  if (priorElapsed >= plan.maxWallMs || (plan.maxRequests !== undefined && admittedBefore >= plan.maxRequests)) throw new Error('Campaign budget exhausted');
  const attemptStarted = Date.now();
  const pool = new RequestPool(plan.pool ? { generation: plan.pool.generation, judge: plan.pool.judge } : undefined, plan.pool?.parent,
    snapshot => { state.pool = snapshot; if (record(snapshot).event) store.event('request.pool', { campaignId, ...record(snapshot) }); }, plan.maxRequests === undefined ? undefined : plan.maxRequests - admittedBefore);
  state.pool = pool.snapshot();
  state.validity = 'unknown';
  state.promotion = 'not_evaluated';
  if (sharedEndpoint) {
    const response = await fetch(sharedEndpoint.url + '/status', { headers: { Authorization: `Bearer ${sharedEndpoint.token}` }, signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('Shared request pool unavailable; refusing independent fallback');
    state.sharedPool = await response.json();
  }
  const broker = await startPool(pool, sharedEndpoint);
  let scheduler: TaskScheduler | undefined;
  let cancelled = false;
  let paused = false;
  let eventCursor = Number(store.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events').get()?.seq ?? 0);
  const save = () => { state.jobs = jobs; state.elapsedMs = priorElapsed + Date.now() - attemptStarted;
    state.admittedRequests = admittedBefore + pool.snapshot().admitted;
    state.updatedAt = new Date().toISOString(); atomic(join(directory, 'campaign.json'), state); store.campaign(campaignId, state); };
  const cancel = () => { cancelled = true; scheduler?.cancel(); };
  const timeout = setTimeout(cancel, plan.maxWallMs - priorElapsed);
  const control = setInterval(() => {
    for (const event of store.events(eventCursor, 500)) {
      eventCursor = event.seq;
      const data = record(event.data);
      if (event.type !== 'campaign.control' || data.id !== campaignId) continue;
      if (data.action === 'pause') { paused = true; scheduler?.pause(); }
      if (data.action === 'resume') { paused = false; scheduler?.resume(); }
      if (data.action === 'cancel') cancel();
    }
    state.status = cancelled ? 'draining' : paused ? 'paused' : 'running'; save();
    if (sharedEndpoint) void fetch(sharedEndpoint.url + '/status', { headers: { Authorization: `Bearer ${sharedEndpoint.token}` }, signal: AbortSignal.timeout(1500) })
      .then(async response => { if (!response.ok) throw Error('shared pool'); state.sharedPool = await response.json(); })
      .catch(() => { state.sharedPool = { status: 'unavailable' }; cancel(); });
  }, 1000);
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  state.status = 'running'; save();
  const pending = plan.jobs.filter(job => record(jobs[job.id]).status !== 'passed');
  // Valid completed failures are never retried into success during resume.
  if (resume && pending.some(job => record(jobs[job.id]).status === 'failed')) {
    cancelled = true; state.resumeReason = 'Valid failed jobs require a new campaign, not replacement';
  }
  try {
    while (pending.length && !cancelled) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const job = pending[i]!;
        if (job.dependsOn?.some(id => ['failed', 'blocked'].includes(String(record(jobs[id]).status)))) {
          jobs[job.id] = { status: 'blocked', reason: 'dependency_failed' }; pending.splice(i, 1);
        }
      }
      const ready = pending.filter(job => (job.dependsOn ?? []).every(id => record(jobs[id]).status === 'passed'));
      if (!ready.length) break;
      scheduler = new TaskScheduler(plan.concurrency);
      if (paused) scheduler.pause();
      await scheduler.run(ready.map(job => ({ id: job.id, ...(job.resource ? { resource: job.resource } : {}), run: async signal => {
        const previous = record(jobs[job.id]);
        const attempt = Number(previous.attempt ?? 0) + 1;
        const attemptId = `${job.id}-${attempt}`;
        const start = Date.now();
        jobs[job.id] = { status: 'running', attempt, startedAt: new Date(start).toISOString(), args: job.args }; save();
        let log = ''; let stopReason: string | null = null;
        const attemptRoot = attempt === 1 ? directory : join(directory, 'attempts', attemptId);
        if (attempt > 1) mkdirSync(attemptRoot, { recursive: true, mode: 0o700 });
        const args = job.args.map(arg => arg.replaceAll('{output}', attemptRoot));
        const preload = new URL('./request-preload.mjs', import.meta.url).href;
        const code = await new Promise<number | null>((resolveCode, reject) => {
          const child = spawn(process.execPath, args, { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, XOPC_EVAL_AUDIT_PATH: join(attemptRoot, `${job.id}-model-requests.jsonl`), XOPC_EVAL_POOL_URL: broker.url, XOPC_EVAL_POOL_TOKEN: broker.token,
              XOPC_EVAL_MODEL_ORIGINS: JSON.stringify(plan.modelOrigins ?? []), NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}` } });
          let killTimer: ReturnType<typeof setTimeout> | undefined;
          const kill = (hard = false) => {
            if (!child.pid) return;
            try {
              if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', ...(hard ? ['/f'] : [])], { stdio: 'ignore' });
              else process.kill(-child.pid, hard ? 'SIGKILL' : 'SIGTERM');
            } catch { /* Process may already have exited. */ }
          };
          const stop = (reason: string) => { if (stopReason) return; stopReason = reason; kill(); killTimer = setTimeout(() => kill(true), 3000); };
          const abort = () => stop('cancelled');
          const deadline = setTimeout(() => stop('timeout'), job.timeoutMs);
          const consume = (chunk: Buffer) => { if (log.length < 2_000_000) log += chunk.toString().slice(0, 2_000_000 - log.length); };
          child.stdout.on('data', consume); child.stderr.on('data', consume);
          signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
          const cleanup = () => { clearTimeout(deadline); if (killTimer) clearTimeout(killTimer); signal.removeEventListener('abort', abort); };
          child.once('error', error => { cleanup(); reject(error); });
          child.once('close', exit => { cleanup(); resolveCode(exit); });
        }).catch(error => { log += String(error); return -1; });
        const orphanTails = closeDeadRequestTails(join(attemptRoot, `${job.id}-model-requests.jsonl`));
        if (orphanTails) store.event('request.owner-dead', { campaignId, jobId: job.id, orphanTails, usage: 'unknown' });
        // Only logs from trusted synthetic fixtures are retained; apply production redaction at export.
        const { redactText } = await import('../coder/packages/protocol/src/index.js');
        writeFileSync(join(directory, attemptId + '.log'), redactText(log), { mode: 0o600 });
        const result = { status: stopReason ? 'interrupted' : code === 0 ? 'passed' : 'failed', attempt, exitCode: code, stopReason,
          durationMs: Date.now() - start, log: attemptId + '.log', endedAt: new Date().toISOString() };
        const evidenceErrors: string[] = [];
        for (const evidence of job.evidence ?? []) {
          const imported = store.import({ ...evidence, path: evidence.path.replaceAll('{output}', attemptRoot), ...(evidence.manifest ? { manifest: evidence.manifest.replaceAll('{output}', attemptRoot) } : {}) });
          if (imported.error) evidenceErrors.push(imported.error);
        }
        if (evidenceErrors.length) result.status = 'failed';
        const finalResult = { ...result, evidenceErrors };
        atomic(join(directory, attemptId + '.json'), finalResult);
        jobs[job.id] = finalResult;
        save();
        return finalResult;
      } })), (snapshot: ScheduleSnapshot) => { state.scheduler = snapshot; save(); });
      for (const job of ready) pending.splice(pending.indexOf(job), 1);
    }
    const drainDeadline = Date.now() + 2000;
    while (pool.snapshot().active > 0 && Date.now() < drainDeadline) await delay(100);
    state.sourceChanged = fingerprint(root) !== sourceHash;
    if (sharedEndpoint) {
      try {
        const response = await fetch(sharedEndpoint.url + '/status', { headers: { Authorization: `Bearer ${sharedEndpoint.token}` }, signal: AbortSignal.timeout(1500) });
        if (!response.ok) throw Error('shared pool');
        state.sharedPool = await response.json();
      } catch { state.sharedPool = { status: 'unavailable' }; cancelled = true; }
    }
    state.status = cancelled ? 'interrupted' : Object.values(jobs).length === plan.jobs.length && Object.values(jobs).every(j => record(j).status === 'passed') ? 'completed' : 'failed';
    state.validity = state.sourceChanged || pool.snapshot().active > 0 || Object.values(jobs).some(j => array(record(j).evidenceErrors).length) ? 'invalid' : 'valid';
    state.promotion = 'not_evaluated';
    state.finishedAt = new Date().toISOString();
    state.requestCoverage = { instrumented: 'fetch to declared modelOrigins only', origins: plan.modelOrigins ?? [], sharedAcrossCampaigns: Boolean(sharedEndpoint), verifiedAllModelCalls: false };
    save(); return state;
  } finally {
    clearTimeout(timeout); clearInterval(control); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    pool.close(); state.pool = pool.snapshot(); save();
    await new Promise<void>(resolveClose => broker.server.close(() => resolveClose()));
  }
}
