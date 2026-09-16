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
  const call = native.call.bind(driver);
  native.call = async (name: string, args: unknown, signal: AbortSignal) => {
    const result = await call(name, args, signal);
    if (name === 'get_window_state') console.log(JSON.stringify({ phase: 'capture-metadata',
      pid: result.data.pid, windowId: result.data.window_id, frameValid: result.data.screenshot_frame_valid,
      degradedReason: result.data.degraded_reason,
      windowTitle: result.data.window_title, rootShapes: result.data.elements?.slice(0, 8).map((element: any) => ({ role: element.role, depth: element.depth, index: element.element_index, parent: element.parent_index })),
      fields: Object.keys(result.data), contentKinds: result.content.map((item: any) => item.type) }));
    return result;
  };
}
const broker = new ComputerBroker(driver, { isVisible: () => true, hasFullControl: () => true,
  requestApproval: async () => false }, { enabled: true });
const owner = 'synthetic-native-validation';
const model = { modelRef: 'synthetic/no-inference', profile: 'structured-tools-v1' as const, origin: 'https://synthetic.invalid', runtimeLocation: 'local' as const };
try {
  const catalog = await broker.command({ op: 'discover', owner, sessionId: 'discovery', query: 'XopcComputerFixture' });
  assert.equal(catalog.apps?.length, 1, 'Start only the disposable XopcComputerFixture app first');
  const open = { op: 'open' as const, owner, appRef: catalog.apps[0].appRef, prepare: true, model };
  const openFixture = async (sessionId: string, mode: 'observe' | 'control') => {
    let result = await broker.command({ ...open, sessionId, mode });
    if (result.errorCode === 'COMPUTER_WINDOW_AMBIGUOUS') {
      const candidates = result.windows?.filter(window => window.title === 'XOPC Computer Use — Synthetic Fixture');
      assert.equal(candidates?.length, 1);
      result = await broker.command({ ...open, windowRef: candidates[0].windowRef, sessionId, mode });
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
  const after = await broker.command({ op: 'act', owner, sessionId: 'control',
    envelope: envelope(before, 'control', { kind: 'setValue', ref: field.ref, text: marker }) });
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
