import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export const NETWORK_CONDITIONS = [
  { name: 'rtt-50ms', delayMs: 50, lossPercent: 0 },
  { name: 'rtt-200ms', delayMs: 200, lossPercent: 0 },
  { name: 'rtt-1000ms', delayMs: 1000, lossPercent: 0 },
  { name: 'loss-1percent', delayMs: 0, lossPercent: 1 },
  { name: 'loss-5percent', delayMs: 0, lossPercent: 5 },
];

/** All changes are inside a newly created test container, never the host's network namespace. */
export class ContainerNetworkFixture {
  constructor(id, ownedIds) {
    assert(/^[0-9a-f]{12,64}$/.test(id) && ownedIds.includes(id), 'Network faults require an owned test container id');
    this.id = id;
  }
  exec(program, args) {
    return execFileSync('docker', ['exec', '--user', 'root', this.id, program, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
  }
  initialize() {
    for (const name of ['XOPC_S5_IN', 'XOPC_S5_OUT']) this.exec('iptables', ['-N', name]);
    this.exec('iptables', ['-I', 'INPUT', '1', '-p', 'tcp', '--dport', '18790', '-j', 'XOPC_S5_IN']);
    this.exec('iptables', ['-I', 'OUTPUT', '1', '-p', 'tcp', '--sport', '18790', '-j', 'XOPC_S5_OUT']);
  }
  netem(condition) {
    assert(NETWORK_CONDITIONS.some(item => item.delayMs === condition.delayMs && item.lossPercent === condition.lossPercent), 'Unknown frozen network condition');
    this.exec('tc', ['qdisc', 'replace', 'dev', 'eth0', 'root', 'handle', '5:', 'netem', 'delay', `${condition.delayMs}ms`, 'loss', `${condition.lossPercent}%`]);
  }
  blackhole(mode) {
    assert(['none', 'both', 'response'].includes(mode), 'Invalid blackhole mode');
    this.exec('iptables', ['-F', 'XOPC_S5_IN']); this.exec('iptables', ['-F', 'XOPC_S5_OUT']);
    if (mode === 'both') this.exec('iptables', ['-A', 'XOPC_S5_IN', '-j', 'DROP']);
    if (mode !== 'none') this.exec('iptables', ['-A', 'XOPC_S5_OUT', '-j', 'DROP']);
  }
  statistics() { return JSON.parse(this.exec('tc', ['-s', '-j', 'qdisc', 'show', 'dev', 'eth0'])); }
  reset() {
    this.blackhole('none');
    const owned = this.statistics().some(item => item.kind === 'netem' && item.handle === '5:');
    if (owned) this.exec('tc', ['qdisc', 'del', 'dev', 'eth0', 'root', 'handle', '5:']);
  }
}

export async function exerciseNetworkMatrix(context) {
  const { fixture, report, newPage, send, settle, close, posts, health, checkpoint, onNextInput, serverInputCount } = context;
  const result = report.networkMatrix = { scope: 'Actual TCP egress netem and port-scoped iptables in one isolated Linux container; not WAN or host-wide faults',
    cases: [], configuredRttInterpretation: 'Delay on the server egress adds the configured delay to each network roundtrip', passed: false };
  let page;
  try {
    for (const condition of NETWORK_CONDITIONS) {
      page = await newPage(condition.name); const started = performance.now(), before = posts(), text = `s5-network-${condition.name}`;
      const record = { ...condition, health: [], submitted: false }; result.cases.push(record);
      try {
        fixture.netem(condition); await send(page, text);
        const count = condition.lossPercent ? 100 : 5;
        // Read-only probes exercise packet loss without creating additional input intents.
        for (let index = 0; index < count; index += 4) {
          const probes = await Promise.all(Array.from({ length: Math.min(4, count - index) }, async () => {
            const start = performance.now();
            try { const response = await health(); return { status: response.status, durationMs: performance.now() - start }; }
            catch { return { status: 'transport-error', durationMs: performance.now() - start }; }
          }));
          record.health.push(...probes);
        }
        record.kernel = fixture.statistics();
        if (condition.lossPercent) {
          for (let attempt = 0; attempt < 5 && !record.kernel.some(item => item.kind === 'netem' && item.drops > 0); attempt++) {
            for (let index = 0; index < 100; index += 4) await Promise.all(Array.from({ length: 4 }, () => health().catch(() => null)));
            record.kernel = fixture.statistics();
          }
          assert(record.kernel.some(item => item.kind === 'netem' && item.drops > 0), 'Packet loss was configured but no actual kernel drop was observed');
        }
      } finally { fixture.reset(); }
      record.recovered = await settle(page);
      assert(posts() >= before && posts() <= before + 1, 'Network recovery repeated an input');
      record.submitted = posts() === before + 1; record.postsBefore = before; record.postsAfter = posts();
      record.durationMs = performance.now() - started;
      await close(page); page = undefined; await checkpoint();
      console.log(`S5 network ${condition.name}: input ${record.submitted ? 'submitted once' : 'not submitted'}`);
    }
    for (const seconds of [10, 60]) {
      page = await newPage(`blackhole-${seconds}s`); const before = posts(), started = performance.now();
      try { fixture.blackhole('both'); await delay(seconds * 1000); }
      finally { fixture.reset(); }
      const recovered = await settle(page); assert.equal(posts(), before, 'Blackhole recovery created an input');
      result.cases.push({ name: `bidirectional-blackhole-${seconds}s`, seconds, durationMs: performance.now() - started, recovered, postsBefore: before, postsAfter: posts() });
      await close(page); page = undefined; await checkpoint();
    }
    page = await newPage('response-blackhole'); const before = posts(), text = 's5-network-response-lost';
    let applied = false;
    onNextInput(() => { fixture.blackhole('response'); applied = true; });
    try {
      await send(page, text);
      const deadline = performance.now() + 15000;
      while (!applied && performance.now() < deadline) await delay(100);
      assert(applied, 'The response-only fault was not applied to the actual input POST');
      await delay(20000); assert.equal(posts(), before + 1, 'Response loss caused an input retry');
    } finally { onNextInput(undefined); fixture.reset(); }
    const recovered = await settle(page), count = await serverInputCount(page, text);
    assert.equal(count, 1, 'Response-only loss must leave exactly one authoritative server input');
    assert.equal(posts(), before + 1);
    result.cases.push({ name: 'input-reachable-response-unreachable', recovered, authoritativeInputCount: count, postsBefore: before, postsAfter: posts() });
    await close(page); page = undefined; result.passed = true; await checkpoint();
  } finally { fixture.reset(); if (page) await close(page).catch(() => {}); }
}
