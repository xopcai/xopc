import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { app } from 'electron';
import { ComputerBroker } from '../src/computer/broker.js';
import { CuaComputerDriver } from '../electron/computer/cua-driver.js';
import type { ComputerAction } from '@xopcai/computer-control-contract';

async function main() {
await app.whenReady();
const [binary, output, count, kinds] = process.argv.slice(2);
const samples = Number(count);
const driver = new CuaComputerDriver(binary, app.getName() === 'Electron' ? 'com.github.Electron' : app.getName());
const broker = new ComputerBroker(driver, { isVisible: () => true, requestApproval: async () => true }, { enabled: true });
const rows: any[] = [];
const failures: any[] = [];
const owner = 'native-input-benchmark';
const model = { modelRef: 'fixture/no-model', profile: 'structured-tools-v1' as const,
  origin: 'https://fixture.invalid', runtimeLocation: 'local' as const };
let buttonCount = 0;
try {
  for (const kind of kinds.split(',') as Array<'activate' | 'setValue' | 'typeText' | 'pressKeys'>) {
    const sessionId = randomUUID();
    const catalog = await broker.command({ op: 'discover', owner, sessionId, query: 'XopcInputBenchmark' });
    assert.equal(catalog.apps?.length, 1);
    await broker.command({ op: 'open', owner, sessionId, appRef: catalog.apps[0].appRef, mode: 'control', prepare: false, model });
    for (let n = 0; n < 100 && broker.snapshot().status === 'pending_authorization'; n++) await delay(20);
    assert.equal(broker.snapshot().status, 'ready', JSON.stringify(broker.snapshot()));
    for (let i = 0; i <= samples; i++) {
      const before = await broker.command({ op: 'observe', owner, sessionId });
      before.frame?.bytes.fill(0);
      const elements = JSON.parse(before.observation!.summary).elements;
      const field = elements.find((e: any) => e.label === 'Benchmark text' && e.role === 'AXTextField');
      const button = elements.find((e: any) => e.label === 'Increment' && e.role === 'AXButton');
      assert.ok(field?.ref && button?.ref);
      const marker = `sample-${i}`;
      const action: ComputerAction = kind === 'activate' ? { kind, ref: button.ref }
        : kind === 'setValue' ? { kind, ref: field.ref, text: marker }
        : kind === 'typeText' ? { kind, text: marker, point: { x: field.bounds.x + field.bounds.width / 2, y: field.bounds.y + field.bounds.height / 2 } }
        : { kind, keys: ['end'] };
      const envelope = { actionId: randomUUID(), sessionId, observationId: before.observation!.id, brokerEpoch: before.brokerEpoch,
        generation: before.generation, grantId: before.grantId!, deadlineAt: Date.now() + 120_000, action };
      const started = performance.now();
      let result = await broker.command({ op: 'act', owner, sessionId, envelope });
      while (result.status === 'pending_action') { await delay(1); result = await broker.command({ op: 'act', owner, sessionId, envelope }); }
      result.frame?.bytes.fill(0);
      if (result.errorCode || result.receipt?.dispatch !== 'completed') {
        failures.push({ kind, iteration: i, errorCode: result.errorCode ?? result.receipt?.errorCode,
          dispatch: result.receipt?.dispatch ?? 'notStarted', nativeMs: result.nativeMs });
        if (!result.receipt || result.receipt.dispatch === 'notStarted') break;
        throw new Error('Native benchmark stopped; uncertain input was not replayed');
      }
      const actionWallMs = performance.now() - started;
      // Separate native read; never grade from the returned action acknowledgement.
      const independent = await driver.observe(before.observation!.target, new AbortController().signal);
      independent.image.fill(0);
      const tree = JSON.parse(independent.summary);
      let verified = false;
      if (kind === 'activate') verified = tree.text.includes(`Input count ${++buttonCount}`);
      if (kind === 'setValue') verified = tree.elements.some((e: any) => e.label === 'Benchmark text' && e.value === marker);
      if (kind === 'typeText') verified = tree.elements.some((e: any) => e.label === 'Benchmark text' && typeof e.value === 'string' && e.value !== field.value && e.value.includes(marker));
      // AX does not expose caret movement: retain timings, label effect unverified.
      if (kind !== 'pressKeys') assert.ok(verified, `Independent ${kind} oracle failed`);
      rows.push({ kind, warmup: i === 0, verified, actionWallMs, nativeMs: result.nativeMs });
      if (i === 0 || i === samples) console.log(JSON.stringify({ kind, iteration: i, completed: true, verified, input: result.nativeMs?.inputDetail }));
    }
    await broker.command({ op: 'release', owner, sessionId });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Benchmark error');
  failures.push({ phase: 'run', errorCode: error instanceof Error && /^COMPUTER_[A-Z_]+$/.test(error.message) ? error.message : 'BASELINE_INCOMPLETE' });
  process.exitCode = 1;
} finally {
  await broker.dispose();
  const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
  const groups = Object.fromEntries(['activate', 'setValue', 'typeText', 'pressKeys'].map(kind => {
    const measured = rows.filter(row => row.kind === kind && !row.warmup);
    const metrics = Object.fromEntries(['wallMs', 'identityCheckMs', 'actionValidationMs', 'sdkCallMs', 'renderGraceMs', 'unattributedMs'].map(key => {
      const values = measured.flatMap(row => typeof row.nativeMs?.inputDetail?.[key] === 'number' ? [row.nativeMs.inputDetail[key]] : []);
      return [key, { count: values.length, p50: percentile(values, .5), p95: percentile(values, .95) }];
    }));
    return [kind, { samples: measured.length, verified: measured.filter(row => row.verified).length, metrics }];
  }));
  const summary = { status: failures.length ? 'incomplete' : 'measured', requestedSamples: samples, groups, failures,
    scroll: 'unsupported_fixture', modelRequests: 0, captureStats: driver.getCaptureStats(), transport: 'in-process broker; no Gateway network or frame upload' };
  await writeFile(output, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), platform: process.platform,
    summary, rows }, null, 2), { mode: 0o600 });
  app.exit(Number(process.exitCode ?? 0));
}

}
void main().catch(() => { app.exit(1); });
