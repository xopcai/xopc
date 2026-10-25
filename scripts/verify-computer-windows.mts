import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { app } from 'electron';
import { ComputerBroker, type BrokerResult } from '../src/computer/broker.js';
import { CuaComputerDriver } from '../electron/computer/cua-driver.js';
import { windowsAppIdentity } from '../electron/computer/windows-apps.js';

async function main() {
await app.whenReady();
assert.equal(process.platform, 'win32');
const [, , binary, output] = process.argv;
assert.ok(binary && output, 'Pass driver path and output JSON path');
const calculatorId = windowsAppIdentity({ bundleId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe',
  launchPath: 'shell:appsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
  name: 'Calculator', kind: 'uwp', pid: 0, running: false, active: false })!.appId;
const driver = new CuaComputerDriver(binary, 'com.github.Electron');
const broker = new ComputerBroker(driver, { isVisible: () => true,
  requestApproval: async request => (request.kind === 'session' ? request.appId : request.target.appId) === calculatorId,
}, { enabled: true });
const sessionId = randomUUID();
const owner = 'windows-calculator-validation';
const receipts: unknown[] = [];
const start = Date.now();
async function status(): Promise<BrokerResult> { return broker.command({ op: 'status', sessionId, owner }); }
try {
  console.log('Windows validation: discover authorized Calculator');
  const apps = await broker.command({ op: 'discover', sessionId, owner, query: '' });
  const catalog = await driver.discover('', AbortSignal.timeout(30_000));
  const name = catalog.find(row => row.appId === calculatorId)?.name;
  assert.ok(name, 'Installed Windows Calculator was not discovered');
  const match = apps.apps?.filter(row => row.name === name);
  assert.equal(match?.length, 1, 'Calculator discovery must be unambiguous');
  await broker.command({ op: 'open', sessionId, owner, appRef: match![0].appRef, mode: 'control', prepare: true,
    model: { modelRef: 'validation/deterministic', profile: 'structured-tools-v1', origin: 'https://validation.invalid', runtimeLocation: 'local' } });
  let opened = await status();
  for (let count = 0; count < 150 && opened.status === 'pending_authorization'; count++) { await delay(100); opened = await status(); }
  assert.equal(opened.status, 'ready', opened.errorCode);
  console.log('Windows validation: exact native window bound');
  for (const labels of [['清除', 'Clear'], ['六', 'Six'], ['乘以', 'Multiply by'], ['七', 'Seven'], ['等于', 'Equals']]) {
    const observed = await broker.command({ op: 'observe', sessionId, owner });
    observed.frame?.bytes.fill(0);
    assert.ok(observed.observation);
    const controls = JSON.parse(observed.observation.summary).elements.filter((e: any) =>
      e.role === 'AXButton' && labels.includes(e.label) && e.semanticActions?.includes('activate'));
    assert.equal(controls.length, 1, 'Expected one freshly observed native Calculator button');
    const envelope = { actionId: randomUUID(), sessionId, observationId: observed.observation.id,
      brokerEpoch: observed.brokerEpoch, generation: observed.generation, grantId: observed.grantId!,
      deadlineAt: Date.now() + 30_000, action: { kind: 'activate' as const, ref: controls[0].ref } };
    await broker.command({ op: 'act', sessionId, owner, envelope });
    await delay(0);
    const result = await broker.command({ op: 'act', sessionId, owner, envelope });
    result.frame?.bytes.fill(0);
    assert.equal(result.receipt?.dispatch, 'completed', result.errorCode ?? result.receipt?.errorCode);
    console.log(`Windows validation: completed input ${receipts.length + 1}/5`);
    receipts.push({ dispatch: result.receipt.dispatch, verification: result.receipt.verification });
    const duplicate = await broker.command({ op: 'act', sessionId, owner, envelope });
    assert.deepEqual(duplicate.receipt, result.receipt, 'A duplicate action must return its existing receipt');
  }
  const final = await broker.command({ op: 'observe', sessionId, owner });
  final.frame?.bytes.fill(0);
  const elements = JSON.parse(final.observation!.summary).elements;
  assert.ok(elements.some((e: any) => e.role === 'AXStaticText' && /^(显示为\s*42|Display is\s*42|42)$/i.test(e.label ?? e.value ?? '')), 'Calculator must show 42');
  await broker.stop();
  assert.equal((await status()).status, 'stopped');
  const evidence = { platform: process.platform, arch: process.arch, driverVersion: '0.36.0',
    result: 'passed', application: 'Windows Calculator', verifiedValue: 42, completedActions: receipts.length,
    receipts, duplicateActionsNotReplayed: true, stopped: true, elapsedMs: Date.now() - start,
    scope: 'Local Electron broker, native UIA activation; no model, gateway network or installer certification' };
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
} finally { await broker.dispose(); app.quit(); }
}

void main().catch(error => { console.error(error); app.exit(1); });
