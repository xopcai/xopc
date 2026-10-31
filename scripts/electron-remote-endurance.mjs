import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export function remoteEnduranceOptions(args) {
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    if (index < 0) return fallback;
    assert(args[index + 1] && !args[index + 1].startsWith('--'), `Missing ${flag}`);
    return Number(args[index + 1]);
  };
  const options = { connectionCycles: value('--connection-cycles', 0), connectionIntervalMs: value('--connection-interval-ms', 5000),
    soakSeconds: value('--soak-seconds', 0), sampleIntervalMs: value('--soak-interval-ms', 60000) };
  assert(Number.isInteger(options.connectionCycles) && options.connectionCycles >= 0 && options.connectionCycles <= 1000, 'Invalid connection cycle count');
  assert(Number.isInteger(options.connectionIntervalMs) && options.connectionIntervalMs >= 1000 && options.connectionIntervalMs <= 60000, 'Invalid connection cycle interval');
  assert(Number.isInteger(options.soakSeconds) && options.soakSeconds >= 0 && options.soakSeconds <= 86400, 'Invalid soak duration');
  assert(Number.isInteger(options.sampleIntervalMs) && options.sampleIntervalMs >= 5000 && options.sampleIntervalMs <= 60000, 'Soak interval must preserve the existing 5000ms minimum normal input cadence');
  assert(options.connectionCycles < 100 || options.connectionIntervalMs >= 5000, 'Full connection acceptance requires the frozen 5000ms minimum interval');
  assert(options.soakSeconds < 86400 || options.sampleIntervalMs === 60000, 'Full soak acceptance requires the frozen 60000ms interval');
  return options;
}

export function soakCoverage(elapsedMs, sampleCount) {
  assert(Number.isFinite(elapsedMs) && elapsedMs >= 0 && Number.isSafeInteger(sampleCount) && sampleCount >= 0, 'Invalid soak coverage');
  const minimumSoakDurationMet = elapsedMs >= 86400000, minimumSoakSamplesMet = sampleCount >= 1200;
  return { minimumSoakDurationMet, minimumSoakSamplesMet, completeFunctionalSoak: minimumSoakDurationMet && minimumSoakSamplesMet };
}

export function fixtureLifetimeSeconds(options) {
  return Math.max(86400, Math.ceil(options.soakSeconds + options.connectionCycles * options.connectionIntervalMs / 1000 + 3600));
}

/** Resource observations are diagnostic; correctness gates do not depend on a new performance budget. */
export function observeApplicationResources(pid) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,%cpu='], { encoding: 'utf8' }).trim().split('\n').map(row => row.trim().split(/\s+/).map(Number));
  const ids = new Set([pid]); let changed = true;
  while (changed) { changed = false; for (const [id, parent] of rows) if (ids.has(parent) && !ids.has(id)) { ids.add(id); changed = true; } }
  const owned = rows.filter(([id]) => ids.has(id));
  assert(owned.some(([id]) => id === pid), 'Supervised application exited');
  let openFds;
  try {
    if (process.platform === 'darwin') openFds = execFileSync('lsof', ['-n', '-P', '-a', '-p', [...ids].join(','), '-F', 'f'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).split('\n').filter(row => /^f\d/.test(row)).length;
  } catch { /* Record unavailable metrics rather than inventing a count. */ }
  return { processes: owned.length, pids: owned.map(([id]) => id), rssMiB: owned.reduce((sum, row) => sum + row[2], 0) / 1024,
    cpuPercentSnapshot: owned.reduce((sum, row) => sum + row[3], 0), openFds: openFds ?? null };
}

/** Operates only through the existing restricted chat UI and separately supervised fixture faults. */
export async function exerciseRemoteEndurance(context) {
  const { options, report, open, close, checkBoundary, posts, checkpoint, resources, send, until, networkFault, restart } = context;
  let page = context.page;
  if (!options.connectionCycles && !options.soakSeconds) return page;
  const result = report.endurance = { options, connectionSamples: [], soakSamples: [], faults: [],
    minimumConnectionCyclesMet: false, ...soakCoverage(0, 0), fullS5Acceptance: false,
    pendingMatrix: ['network-layer delay/loss/blackholes', 'certificate/auth/version combinations', 'real sleep/wake', 'supported upgrade/rollback combinations'],
    performanceAcceptance: 'deferred by user; observations only' };
  console.log(`S5 endurance: ${options.connectionCycles} connection cycles, ${options.soakSeconds}s soak`);
  if (options.connectionCycles) {
    await close(page);
    for (let index = 0; index < options.connectionCycles; index++) {
      const started = performance.now(), before = posts(), target = index % 2 ? 'B' : 'A';
      page = await open(target);
      await checkBoundary(page, target, true);
      const openedMs = performance.now() - started;
      await close(page);
      assert.equal(posts(), before, 'A connection cycle resubmitted an input');
      result.connectionSamples.push({ cycle: index + 1, target, openedMs, totalMs: performance.now() - started, posts: before, resources: resources() });
      result.minimumConnectionCyclesMet = result.connectionSamples.length >= 100;
      await checkpoint(); console.log(`S5 connection ${index + 1}/${options.connectionCycles}`);
      if (index + 1 < options.connectionCycles) await delay(Math.max(0, options.connectionIntervalMs - (performance.now() - started)));
    }
    page = await open('A');
  }
  if (options.soakSeconds) {
    const started = performance.now();
    result.soakStartedAt = new Date().toISOString();
    while (performance.now() - started < options.soakSeconds * 1000) {
      const cycleStarted = performance.now(), index = result.soakSamples.length + 1, before = posts();
      await until(() => page.locator('#status').textContent().then(value => value === '就绪'));
      await send(page, `s5-soak-${index}`);
      await until(async () => await page.locator('#status').textContent() === '就绪'
        && await page.locator('article[data-role="user"] p').last().innerText() === `s5-soak-${index}`
        && (await page.locator('article[data-role="assistant"]').last().innerText()).includes('REMOTE_CHAT_OK'));
      assert.equal(posts(), before + 1, 'A soak input was submitted more than once');
      const resourceStatus = await page.evaluate(() => fetch('/api/sessions').then(response => response.status));
      assert.equal(resourceStatus, 200, 'Restricted server resource read failed');
      await checkBoundary(page, 'A', false);
      if (index % 10 === 0) {
        const start = performance.now(); await networkFault(page, 'offline');
        result.faults.push({ iteration: index, kind: 'application-proxy-offline-10s', durationMs: performance.now() - start });
      }
      if (index % 30 === 0) {
        const start = performance.now(); await networkFault(page, 'half-open');
        result.faults.push({ iteration: index, kind: 'suppressed-realtime-frames', durationMs: performance.now() - start });
      }
      if (index % 60 === 0) {
        const start = performance.now(); page = await restart(); await checkBoundary(page, 'A', false);
        result.faults.push({ iteration: index, kind: 'application-restart', durationMs: performance.now() - start });
      }
      assert.equal(posts(), before + 1, 'Recovery or restart resubmitted a soak input');
      result.soakElapsedMs = performance.now() - started;
      result.soakSamples.push({ iteration: index, elapsedMs: result.soakElapsedMs, cycleMs: performance.now() - cycleStarted, posts: posts(), resources: resources() });
      await checkpoint(); console.log(`S5 soak ${index}: ${Math.floor(result.soakElapsedMs / 1000)}/${options.soakSeconds}s`);
      const remaining = options.soakSeconds * 1000 - (performance.now() - started);
      if (remaining > 0) await delay(Math.min(remaining, Math.max(0, options.sampleIntervalMs - (performance.now() - cycleStarted))));
    }
    result.soakElapsedMs = performance.now() - started;
    Object.assign(result, soakCoverage(result.soakElapsedMs, result.soakSamples.length));
    result.soakFinishedAt = new Date().toISOString();
  }
  await checkpoint();
  return page;
}
