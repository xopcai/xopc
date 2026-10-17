/** Electron-only live phases. Use run-computer-flow-validation.mts to isolate state and restart. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { ComputerCommandSchema } from '@xopcai/computer-control-contract';
import { DesktopEndpointHost } from '../electron/computer/desktop-host.js';
import type { CuaComputerDriver } from '../electron/computer/cua-driver.js';
import { ComputerRuntime, type ComputerUseInput } from '../src/computer/runtime.js';
import { ComputerFlowStore } from '../src/computer/flows.js';
import { verifyComputerExpectation } from '../src/computer/task-state.js';
import { ConfigSchema } from '../src/config/schema.js';
import { AgentCatalogRepository } from '../src/agent-catalog/repository.js';
import { createConversation } from '../src/storage/sqlite/conversation-repository.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { isComputerControlActive } from '../src/computer/control-guard.js';

const APP = 'com.apple.TextEdit';
const BASELINE = 'New Document', DESTINATION = 'Open and Save';
const EXPECT = { kind: 'text', text: 'HTML Saving Options' } as const;
const pause = () => new Promise(resolve => setTimeout(resolve, 30));

async function main() {
  const [phase, rawRoot] = process.argv.slice(2);
  assert.ok(['capture', 'reuse', 'unknown'].includes(phase));
  const root = resolve(rawRoot);
  assert.match(basename(root), /^xopc-real-flow-[A-Za-z0-9]+$/, 'Only runner-created disposable state roots are allowed');
  assert.equal(process.env.XOPC_STATE_DIR, root, 'An isolated state directory is mandatory');
  assert.equal(process.env.XOPC_CREDENTIALS_DIR, join(root, 'credentials'));
  app.setPath('userData', join(root, 'electron'));
  await app.whenReady();
  app.setActivationPolicy('accessory');
  await mkdir(join(root, 'electron'), { recursive: true });
  const workspace = join(root, 'workspace');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'flow-validation': {
    baseUrl: 'https://flow-validation.invalid/v1', apiKey: 'synthetic-local-only', api: 'openai-completions',
    models: [{ id: 'native-navigation', input: ['text', 'image'], computerUse: { profile: 'structured-tools-v1' } }],
  } } }), { mode: 0o600 });
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const catalog = new AgentCatalogRepository(); catalog.ensureInitialized();
  if (!catalog.get('flow-validation')) catalog.create({ id: 'flow-validation', workspace,
    models: { computerUse: { primary: 'flow-validation/native-navigation' } } } as any, { ready: true });
  const owner = createConversation({ agentId: 'flow-validation', sourceChannel: 'webchat' }, workspace).key;
  const config = ConfigSchema.parse({ computer: { enabled: true } });
  const window = new BrowserWindow({ width: 360, height: 150, show: false,
    title: 'XOPC isolated flow validation', webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<title>XOPC isolated flow validation</title><p>Validating TextEdit settings navigation only.</p>');
  window.showInactive();
  const host = new DesktopEndpointHost({ connection: () => undefined, window: () => window });
  const broker = host.broker;
  const driver = (broker as any).driver as CuaComputerDriver;
  const approvals = { session: 0, action: 0 };
  const approve = (host as any).approve.bind(host);
  (host as any).approve = async (request: any, signal: AbortSignal) => {
    approvals[request.kind as 'session' | 'action']++;
    return approve(request, signal);
  };
  let mode: 'scenario' | 'setup' = 'setup', observations = 0, inputs = 0, setupInputs = 0, modelRequests = 0, hintRequests = 0;
  let lastGrantId: string | undefined;
  let lastObservation: any, lastNodes: any[] = [], lost = false, actAfterLoss = 0, lostOracle = false;
  const target = driver.resolveTarget.bind(driver);
  driver.resolveTarget = async (...args) => {
    const value = await target(...args);
    const windows = await (driver as any).listWindows(value.pid, args[1]);
    assert.equal(windows.find((w: any) => String(w.windowId) === value.windowId)?.title, 'Settings', 'Never capture a document');
    return value;
  };
  const observe = driver.observe.bind(driver);
  driver.observe = async (...args) => {
    assert.equal(args[0].appId, APP);
    const windows = await (driver as any).listWindows(args[0].pid, args[1]);
    assert.equal(windows.find((w: any) => String(w.windowId) === args[0].windowId)?.title, 'Settings');
    const value = await observe(...args); observations++;
    lastNodes = JSON.parse(value.summary).elements;
    return value;
  };
  const perform = driver.perform.bind(driver);
  driver.perform = async (target, action, signal) => {
    assert.equal(action.kind, 'activate', 'No keys, typing, coordinates or preference mutations');
    const node = lastNodes.find(node => node.ref === (action as any).ref);
    assert.equal(node?.role, 'AXRadioButton');
    assert.equal(node.label, mode === 'scenario' ? DESTINATION : BASELINE);
    if (mode === 'scenario') inputs++; else setupInputs++;
    return perform(target, action, signal);
  };
  const frames = new Map<string, Uint8Array>();
  const endpoint: any = {
    bindings: { get: () => undefined, resolve: () => undefined },
    registry: { get: (id: string) => id === 'live-textedit' ? { endpointId: id, kind: 'desktop' } : undefined,
      getTool: () => ({ revision: 'live-validation' }) },
    uploads: { takeComputerFrame: (id: string) => { const image = frames.get(id); frames.delete(id); return image; } },
    invocations: { invoke: async ({ arguments: raw }: any) => {
      const command = ComputerCommandSchema.parse(raw);
      if (command.op === 'act' && lost) actAfterLoss++;
      const reply = await broker.command(command);
      if (reply.observation) lastObservation = reply.observation;
      if (reply.grantId) lastGrantId = reply.grantId;
      if (phase === 'unknown' && mode === 'scenario' && command.op === 'act' && reply.receipt?.dispatch === 'completed') {
        assert.equal(inputs, 1);
        lostOracle = verifyComputerExpectation(EXPECT, reply.observation)?.status === 'satisfied';
        reply.frame?.bytes.fill(0); lost = true;
        throw new Error('Synthetic lost reply after a real native input');
      }
      const { frame, ...value } = reply;
      const content: any[] = [{ type: 'json', value }];
      const invocationId = randomUUID();
      if (frame) { frames.set(invocationId, frame.bytes); content.push({ type: 'file', fileId: invocationId, mimeType: frame.mimeType }); }
      return { invocationId, content };
    } },
  };
  const runtime = new ComputerRuntime(endpoint, () => config, () => 'live-textedit');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://flow-validation.invalid/v1/chat/completions', 'No hosted inference or network fallback');
    modelRequests++;
    const body = JSON.parse(String(init?.body));
    const prompt = body.messages[1].content[1].text;
    if (prompt.includes('Untrusted historical navigation hints')) hintRequests++;
    const snapshot = JSON.parse(prompt.split('Untrusted window context: ')[1].split('\n')[0]);
    const matches = snapshot.elements.filter((e: any) => e.role === 'AXRadioButton' && e.label === DESTINATION);
    assert.equal(matches.length, 1); assert.equal(matches[0].selected, false);
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'computer_proposal',
      arguments: JSON.stringify({ proposal: { kind: 'action', action: { kind: 'activate', ref: matches[0].ref } } }) } }] } }] });
  };
  async function settle(input: ComputerUseInput) {
    let result = await runtime.execute(owner, input);
    const deadline = Date.now() + 30_000;
    while (result.status === 'pending_authorization' || result.status === 'pending_action') {
      assert.ok(Date.now() < deadline, 'Authorization timed out'); await pause();
      result = await runtime.execute(owner, result.status === 'pending_authorization' ? { op: 'observe' } : { op: 'step', goal: 'Resume the held action' });
    }
    return result;
  }
  async function open() {
    const found = await runtime.execute(owner, { op: 'discover', query: APP }); assert.equal(found.apps?.length, 1);
    const input = { op: 'open', appRef: found.apps[0].appRef, prepare: false, mode: 'control' } as const;
    let result = await settle(input);
    if (result.errorCode === 'COMPUTER_WINDOW_AMBIGUOUS') {
      const settings = result.windows?.filter(w => w.title === 'Settings'); assert.equal(settings?.length, 1);
      result = await settle({ ...input, windowRef: settings[0].windowRef });
    }
    return result;
  }
  // Setup and restoration use separate ordinary Broker leases, under the same local policy.
  let firstSetup = true;
  async function baseline() {
    mode = 'setup';
    const opened = await open();
    assert.equal(opened.status, 'ready', JSON.stringify({ stage: mode, status: opened.status, errorCode: opened.errorCode }));
    await runtime.execute(owner, { op: 'observe' });
    const tab = lastNodes.find(e => e.role === 'AXRadioButton' && e.label === BASELINE); assert.ok(tab);
    if (phase === 'capture' && firstSetup) assert.equal(tab.selected, true, 'Open Settings on New Document before starting');
    firstSetup = false;
    if (!tab.selected) {
      const s = lastObservation;
      const command = { op: 'act' as const, owner, sessionId: s.sessionId, envelope: { actionId: randomUUID(), sessionId: s.sessionId,
        observationId: s.id, brokerEpoch: s.brokerEpoch, generation: s.generation, grantId: lastGrantId!,
        deadlineAt: Date.now() + 10_000, action: { kind: 'activate' as const, ref: tab.ref } } };
      let result = await broker.command(command);
      if (result.status === 'pending_action') { await pause(); result = await broker.command(command); }
      result.frame?.bytes.fill(0); assert.equal(result.receipt?.dispatch, 'completed', result.errorCode);
      assert.equal(JSON.parse(result.observation!.summary).elements.find((e: any) => e.role === 'AXRadioButton' && e.label === BASELINE)?.selected, true);
    }
    await runtime.execute(owner, { op: 'close' });
  }
  try {
    const prior = phase === 'capture' ? undefined : JSON.parse(await readFile(join(root, 'capture.json'), 'utf8'));
    const listed = await runtime.execute(owner, { op: 'flows' });
    assert.equal(listed.flows?.length, phase === 'capture' ? 0 : 1);
    if (prior) { assert.notEqual(process.pid, prior.pid); assert.equal(listed.flows[0].id, prior.flowId); }
    await host.setComputerAppAccess(APP, false);
    const denied = await open(); assert.equal(denied.errorCode, 'COMPUTER_APP_NOT_AUTHORIZED');
    assert.equal(inputs, 0); assert.equal(modelRequests, 0); assert.equal(observations, 0);
    await host.setComputerAppAccess(APP, true);
    await baseline();
    mode = 'scenario';
    const sessionChecksBeforeOpen = approvals.session;
    const opened = await open();
    assert.equal(opened.status, 'ready', JSON.stringify({ stage: mode, status: opened.status, errorCode: opened.errorCode }));
    assert.ok(approvals.session > sessionChecksBeforeOpen, 'A saved flow must not bypass session access checks');
    const beforeInputs = inputs, beforeModels = modelRequests, beforeApprovals = { ...approvals };
    const step = { op: 'step', goal: 'Open the Open and Save settings tab; do not modify preferences', expect: EXPECT,
      ...(prior ? { flowId: prior.flowId } : {}) } as const;
    if (phase === 'unknown') {
      await assert.rejects(settle(step), /COMPUTER_DISPATCH_FAILED/);
      assert.ok(lost && lostOracle, 'The real tab changed before the reply was lost');
      const report = runtime.getReport(owner)!;
      assert.equal(report.failure?.dispatch, 'unknown'); assert.equal(report.counters.unknownDispatches, 1);
      assert.equal(report.counters.rescueAttempts, 0);
      assert.equal(report.status, 'released'); assert.equal(isComputerControlActive(owner), false);
      assert.equal(actAfterLoss, 0);
      assert.equal((await runtime.execute(owner, { op: 'close', saveFlowAs: 'Unknown outcome' })).errorCode, 'COMPUTER_FLOW_NOT_VERIFIED');
    } else {
      const result = await settle(step); assert.equal(result.receipt?.dispatch, 'completed'); assert.equal(result.verified, true);
      const closed = await runtime.execute(owner, { op: 'close', ...(phase === 'capture' ? { saveFlowAs: 'TextEdit Open and Save navigation' } : {}) });
      assert.equal(closed.status, 'stopped'); assert.ok(!closed.errorCode);
      if (phase === 'capture') {
        assert.ok(closed.savedFlow);
        await writeFile(join(root, 'capture.json'), JSON.stringify({ pid: process.pid, flowId: closed.savedFlow.id }), { mode: 0o600 });
        const stored = new ComputerFlowStore().list(JSON.stringify(['flow-validation', workspace]));
        assert.equal(stored.length, 1); assert.equal(stored[0].coverage, 'partial'); assert.deepEqual(stored[0].condition, EXPECT);
        assert.ok(!/"ref"|"goal"|"image"|"coordinates"|synthetic-local-only/.test(JSON.stringify(stored)));
      }
    }
    assert.equal(inputs - beforeInputs, 1); assert.equal(modelRequests - beforeModels, 1);
    assert.equal(hintRequests, prior ? 1 : 0);
    assert.equal(approvals.action - beforeApprovals.action, 1, 'Every reused input must pass the real local access policy');
    assert.equal(frames.size, 0);
    assert.equal((await runtime.execute(owner, { op: 'flows' })).flows?.length, 1);
    const scenarioReport = runtime.getReport(owner)!;
    const evidence = { status: 'passed', phase, pid: process.pid, app: APP, isolatedState: true, restarted: !!prior,
      deniedWithoutAppAccess: true, localSessionChecks: approvals.session, localActionChecks: approvals.action,
      scenarioNativeInputs: inputs, modelRequests, hintRequests, uncertainReplyInjected: lost, actAfterLoss,
      realEffectObservedAfterLoss: lostOracle, failureDispatch: scenarioReport.failure?.dispatch ?? null,
      unknownDispatches: scenarioReport.counters.unknownDispatches, releaseStatus: scenarioReport.status,
      rescueAttempts: runtime.getReport(owner)?.counters.rescueAttempts ?? 0,
      hostedInference: false };
    // Cleanup is a different explicitly authorized tab activation, never an uncertain-input replay.
    await baseline(); evidence.localSessionChecks = approvals.session; evidence.localActionChecks = approvals.action;
    await host.setComputerAppAccess(APP, false);
    await writeFile(join(root, `${phase}-result.json`), JSON.stringify({ ...evidence, cleanupInputs: setupInputs, baselineRestored: true }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(evidence));
  } finally {
    globalThis.fetch = originalFetch;
    for (const image of frames.values()) image.fill(0); frames.clear();
    await runtime.shutdown(); await broker.dispose(); window.destroy(); closeXopcDatabase();
  }
}
void main().then(() => app.exit(0), error => { console.error(error instanceof Error ? error.message : 'Live flow validation failed'); app.exit(1); });
