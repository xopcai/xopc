/** Real desktop endpoint: OS-backed identity, signed hello, WebSocket tools and HTTP frame upload. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { DesktopEndpointHost } from '../electron/computer/desktop-host.js';
import { APP, BASELINE, BASELINE_TEXT, DESTINATION, EXPECT } from './lib/computer-flow-network-target.mjs';
import { verifyComputerExpectation } from '../src/computer/task-state.js';

async function main() {
  const root = process.env.XOPC_STATE_DIR!;
  assert.match(basename(root), /^xopc-network-flow-[A-Za-z0-9]+$/);
  assert.equal(process.env.DASHSCOPE_API_KEY, undefined); assert.equal(process.env.QWEN_API_KEY, undefined);
  app.setPath('userData', join(root, 'electron'));
  await app.whenReady(); app.setActivationPolicy('accessory');
  const window = new BrowserWindow({ width: 360, height: 150, show: false, title: 'XOPC network flow validation',
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<title>XOPC network flow validation</title><p>Native navigation validation only.</p>');
  window.showInactive();
  const host = new DesktopEndpointHost({ connection: () => ({ port: Number(process.env.XOPC_FLOW_PROXY_PORT), token: process.env.XOPC_FLOW_GATEWAY_TOKEN! }), window: () => window });
  const broker = host.broker, driver = (broker as any).driver;
  let mode = 'setup', observations = 0, inputs = 0, cleanupInputs = 0;
  let lastNodes: any[] = [], lastObservation: any, lastGrantId: string | undefined;
  const approvals = { session: 0, action: 0 };
  const approve = (host as any).approve.bind(host);
  (host as any).approve = async (request: any, signal: AbortSignal) => { approvals[request.kind as 'session' | 'action']++; return approve(request, signal); };
  const observe = driver.observe.bind(driver);
  driver.observe = async (...args: any[]) => {
    assert.equal(args[0].appId, APP);
    assert.equal(args[0].pid, Number(process.env.XOPC_FLOW_FIXTURE_PID));
    const value = await observe(...args); observations++; lastNodes = JSON.parse(value.summary).elements; return value;
  };
  const perform = driver.perform.bind(driver);
  driver.perform = async (target: any, action: any, signal: AbortSignal) => {
    const node = lastNodes.find(n => n.ref === action.ref);
    assert.equal(action.kind, 'activate'); assert.equal(node?.role, 'AXButton');
    assert.ok(node?.label === (mode === 'scenario' ? DESTINATION : BASELINE), 'COMPUTER_VALIDATION_NATIVE_TARGET_REQUIRED');
    if (mode === 'scenario') inputs++; else cleanupInputs++;
    return perform(target, action, signal);
  };
  const command = broker.command.bind(broker);
  broker.command = async (input: any) => {
    const result = await command(input);
    if (result.observation) lastObservation = result.observation;
    if (result.grantId) lastGrantId = result.grantId;
    return result;
  };
  process.on('message', async (message: any) => {
    try {
      let value: unknown;
      switch (message.op) {
        case 'access': value = await host.setComputerAppAccess(APP, message.allowed); break;
        case 'drained': await broker.stop(); value = true; break;
        case 'mode': mode = message.mode; value = true; break;
        case 'baseline': {
          assert.equal(mode, 'setup');
          const tab = lastNodes.find(n => n.role === 'AXButton' && n.label === BASELINE); assert.ok(tab);
          const atStart = JSON.parse(lastObservation.summary).text.includes(BASELINE_TEXT);
          if (message.requireSelected) assert.equal(atStart, true, 'Start on the native start page');
          if (!atStart) {
            const s = lastObservation;
            const input = { op: 'act', owner: s.owner ?? message.owner, sessionId: s.sessionId, envelope: { actionId: randomUUID(), sessionId: s.sessionId,
              observationId: s.id, brokerEpoch: s.brokerEpoch, generation: s.generation, grantId: lastGrantId!, deadlineAt: Date.now() + 10_000,
              action: { kind: 'activate', ref: tab.ref } } } as any;
            let result = await broker.command(input);
            if (result.status === 'pending_action') { await new Promise(r => setTimeout(r, 30)); result = await broker.command(input); }
            result.frame?.bytes.fill(0); assert.equal(result.receipt?.dispatch, 'completed');
          }
          value = { selected: JSON.parse(lastObservation.summary).text.includes(BASELINE_TEXT) }; break;
        }
        case 'status': value = { pid: process.pid, connected: host.snapshot().connected, claim: host.snapshot().claim,
          observations, inputs, cleanupInputs, approvals, sessionStatus: broker.snapshot().status,
          pageObserved: verifyComputerExpectation(EXPECT, lastObservation)?.status === 'satisfied' }; break;
        case 'stop': await host.close(); window.destroy(); process.send?.({ id: message.id, value: true }, () => app.exit(0)); return;
        default: throw new Error('Unknown private test command');
      }
      process.send?.({ id: message.id, value });
    } catch { process.send?.({ id: message.id, error: 'VALIDATION_DESKTOP_OPERATION_FAILED' }); }
  });
  await host.start();
  process.send?.({ ready: true, pid: process.pid });
}
void main().catch(() => { console.error('Network desktop validation startup failed'); app.exit(1); });
