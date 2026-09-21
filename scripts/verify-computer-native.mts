/** Run the bundled script in Electron against the disposable Swift fixture only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { ComputerBroker } from '../src/computer/broker.js';
import { CuaComputerDriver } from '../electron/computer/cua-driver.js';

async function main() {
await app.whenReady();
const binary = process.argv[2];
if (!binary) throw new Error('Pass the verified Cua driver binary path');
const driver = new CuaComputerDriver(binary, 'com.github.Electron');
if (process.env.XOPC_COMPUTER_NATIVE_DIAGNOSTICS === '1') {
  const native = driver as any;
  const getWindowState = native.getWindowState.bind(driver);
  native.getWindowState = async (...args: unknown[]) => {
    const result = await getWindowState(...args);
    console.log(JSON.stringify({ phase: 'capture-metadata', pid: result.pid, windowId: result.windowId.toString(),
      frameValid: result.screenshotFrameValid, degradedReason: result.degradedReason, windowTitle: result.windowTitle,
      rootShapes: result.elements?.slice(0, 8).map((element: any) => ({ role: element.role, depth: element.depth,
        index: element.elementIndex.toString(), parent: element.parentIndex?.toString() })), imageCount: result.images.length }));
    return result;
  };
}
const broker = new ComputerBroker(driver, { isVisible: () => true, requestApproval: async () => true }, { enabled: true });
const owner = 'synthetic-native-validation';
const model = { modelRef: 'synthetic/no-inference', profile: 'structured-tools-v1' as const, origin: 'https://synthetic.invalid', runtimeLocation: 'local' as const };
try {
  const catalog = await broker.command({ op: 'discover', owner, sessionId: 'discovery', query: 'XopcComputerFixture' });
  assert.equal(catalog.apps?.length, 1, 'Start only the disposable XopcComputerFixture app first');
  const open = { op: 'open' as const, owner, appRef: catalog.apps[0].appRef, prepare: true, model };
  const waitForDecision = async (sessionId: string) => {
    const deadline = Date.now() + 5_000;
    while (broker.snapshot().status === 'pending_authorization' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    return broker.command({ op: 'status', owner, sessionId });
  };
  const openFixture = async (sessionId: string, mode: 'observe' | 'control') => {
    let result = await broker.command({ ...open, sessionId, mode });
    if (result.status === 'pending_authorization') result = await waitForDecision(sessionId);
    if (result.errorCode === 'COMPUTER_WINDOW_AMBIGUOUS') {
      const candidates = result.windows?.filter(window => window.title === 'XOPC Computer Use — Synthetic Fixture');
      assert.equal(candidates?.length, 1);
      result = await broker.command({ ...open, windowRef: candidates[0].windowRef, sessionId, mode });
      if (result.status === 'pending_authorization') result = await waitForDecision(sessionId);
    }
    return result;
  };
  const readSession = await openFixture('read', 'observe');
  assert.equal(readSession.status, 'ready', JSON.stringify(readSession));
  const observed = await broker.command({ op: 'observe', owner, sessionId: 'read' });
  assert.equal(observed.observation?.target.appId, 'ai.xopc.discovery-fixture');
  assert.match(observed.observation.summary, /Continue/);
  observed.frame?.bytes.fill(0);
  const envelope = (o: typeof observed, sessionId: string, action: any) => ({
    actionId: sessionId, sessionId, observationId: o.observation!.id, brokerEpoch: o.brokerEpoch,
    generation: o.generation, grantId: o.grantId!, deadlineAt: Date.now() + 10_000, action,
  });
  await assert.rejects(broker.command({ op: 'act', owner, sessionId: 'read', envelope: envelope(observed, 'read', { kind: 'wait', durationMs: 0 }) }), /READ_ONLY/);
  await broker.command({ op: 'release', owner, sessionId: 'read' });
  const controlSession = await openFixture('control', 'control');
  assert.equal(controlSession.status, 'ready', JSON.stringify(controlSession));
  const before = await broker.command({ op: 'observe', owner, sessionId: 'control' });
  before.frame?.bytes.fill(0);
  const tree = JSON.parse(before.observation!.summary);
  const field = tree.elements.find((element: any) => element.role === 'AXTextField' && element.label === 'Fixture text');
  assert.ok(field?.ref, 'Expected the disposable fixture field');
  const marker = `Computer discovery ${randomUUID().slice(0, 8)}`;
  const action = { op: 'act' as const, owner, sessionId: 'control',
    envelope: envelope(before, 'control', { kind: 'setValue', ref: field.ref, text: marker }) };
  let after = await broker.command(action);
  if (after.status === 'pending_action') { await new Promise(resolve => setTimeout(resolve, 0)); after = await broker.command(action); }
  after.frame?.bytes.fill(0);
  assert.equal(after.receipt?.dispatch, 'completed');
  assert.ok(after.observation!.summary.includes(marker));
  console.log(JSON.stringify({ status: 'passed', appDiscovery: true, readOnlyEnforced: true, nativeFieldVerified: true, personalScreenshots: false }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Native validation failed');
  process.exitCode = 1;
} finally { await broker.dispose(); app.exit(process.exitCode ?? 0); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Native validation failed'); app.exit(1); });
