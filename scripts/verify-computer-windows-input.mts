import '../src/infra/http-proxy-env.js';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { app } from 'electron';
import { ComputerCommandSchema, type ComputerAction } from '@xopcai/computer-control-contract';
import { ComputerBroker, type BrokerResult } from '../src/computer/broker.js';
import { CuaComputerDriver } from '../electron/computer/cua-driver.js';
import { windowsAppIdentity } from '../electron/computer/windows-apps.js';
import { ComputerRuntime } from '../src/computer/runtime.js';
import { ConfigSchema } from '../src/config/schema.js';
import { AgentCatalogRepository } from '../src/agent-catalog/repository.js';
import { createConversation } from '../src/storage/sqlite/conversation-repository.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { getModelCatalogStore } from '../src/providers/model-catalog-store.js';
import { getModelRegistry } from '../src/providers/model-registry.js';

const EXPECTED = 'Windows 输入验证 OK';

async function main() {
  const [binary, fixture, oracle, stateRoot, modelRef] = process.argv.slice(2);
  assert.equal(process.env.XOPC_STATE_DIR, stateRoot);
  assert.ok(resolve(fixture).startsWith(resolve(dirname(stateRoot))));
  app.setPath('userData', join(stateRoot, 'electron'));
  await app.whenReady();
  const allowedApp = windowsAppIdentity({ bundleId: fixture, name: 'XopcInputFixture.exe', pid: 0, running: false, active: false })!.appId;
  const driver = new CuaComputerDriver(binary, 'com.github.Electron');
  const broker = new ComputerBroker(driver, { isVisible: () => true,
    requestApproval: async request => (request.kind === 'session' ? request.appId : request.target.appId) === allowedApp,
  }, { enabled: true });
  const start = Date.now();
  const directOwner = 'native-input-validation', directSession = randomUUID();
  let current: BrokerResult;
  const readOracle = async () => JSON.parse(await readFile(oracle, 'utf8'));
  async function observe() {
    current = await broker.command({ op: 'observe', owner: directOwner, sessionId: directSession });
    current.frame?.bytes.fill(0);
    return JSON.parse(current.observation!.summary).elements as Array<any>;
  }
  async function act(action: ComputerAction) {
    const command = { op: 'act' as const, owner: directOwner, sessionId: directSession,
      envelope: { actionId: randomUUID(), sessionId: directSession, observationId: current.observation!.id,
        brokerEpoch: current.brokerEpoch, generation: current.generation, grantId: current.grantId!, deadlineAt: Date.now() + 60_000, action } };
    await broker.command(command); await delay(0);
    current = await broker.command(command); current.frame?.bytes.fill(0);
    assert.equal(current.receipt?.dispatch, 'completed', current.errorCode ?? current.receipt?.errorCode);
    const duplicate = await broker.command(command);
    assert.deepEqual(duplicate.receipt, current.receipt);
  }
  try {
    console.log('Windows input validation: binding disposable fixture');
    const found = await broker.command({ op: 'discover', owner: directOwner, sessionId: directSession, query: 'XopcInputFixture' });
    assert.equal(found.apps?.length, 1, 'Expected exactly one disposable fixture application');
    console.log('Windows input validation: fixture discovered');
    await broker.command({ op: 'open', owner: directOwner, sessionId: directSession, appRef: found.apps[0].appRef,
      mode: 'control', prepare: true, model: { modelRef: 'validation/native-input', profile: 'structured-tools-v1', origin: 'https://validation.invalid', runtimeLocation: 'local' } });
    for (let count = 0; count < 300; count++) {
      current = await broker.command({ op: 'status', owner: directOwner, sessionId: directSession });
      if (current.status !== 'pending_authorization') break;
      await delay(100);
    }
    assert.equal(current!.status, 'ready', current!.errorCode);
    console.log('Windows input validation: fixture ready');
    const nodes = await observe();
    const field = nodes.filter(e => e.label === 'Message' && e.inputAllowed === true);
    console.log('Windows input validation: native safety metadata captured');
    assert.equal(field.length, 1, 'Native secure-field metadata must certify Message');
    assert.ok(nodes.some(e => e.role === 'AXSecureTextField'), 'Password fields must be recognized');
    assert.ok(!nodes.some(e => e.label === 'Read only' && e.inputAllowed === true), 'Readonly field cannot be writable');
    for (const node of nodes.filter(e => e.role === 'AXSecureTextField' || e.role === 'UIAUnverifiedEdit')) {
      await assert.rejects(broker.command({ op: 'act', owner: directOwner, sessionId: directSession,
        envelope: { actionId: randomUUID(), sessionId: directSession, observationId: current.observation!.id,
          brokerEpoch: current.brokerEpoch, generation: current.generation, grantId: current.grantId!, deadlineAt: Date.now() + 30_000,
          action: { kind: 'setValue', ref: node.ref, text: 'must-not-write' } } }), /EDITABLE_TARGET_REQUIRED/);
    }
    await act({ kind: 'setValue', ref: field[0].ref, text: 'Seed ' });
    assert.equal((await readOracle()).text, 'Seed ');
    const refreshed = await observe();
    const box = refreshed.find(e => e.label === 'Message').bounds;
    await act({ kind: 'typeText', text: '中文🙂\nsecond line', point: { x: box.x + box.width / 2, y: box.y + box.height / 2 } });
    assert.equal((await readOracle()).text.replaceAll('\r\n', '\n'), 'Seed 中文🙂\nsecond line');
    await observe();
    await act({ kind: 'pressKeys', keys: ['end'] });
    assert.equal((await readOracle()).lastKey, 'End', 'App-owned key event oracle');
    await observe();
    await act({ kind: 'pressKeys', keys: ['backspace'] });
    assert.equal((await readOracle()).text.replaceAll('\r\n', '\n'), 'Seed 中文🙂\nsecond lin');
    const clean = await observe();
    await act({ kind: 'setValue', ref: clean.find(e => e.label === 'Message').ref, text: 'Replace this sample' });
    await broker.stop();
    console.log('Windows input validation: native text, Unicode, keys and negative guards passed');

    openXopcDatabase({ path: join(stateRoot, 'xopc.db') });
    const savedCatalog = await readFile(join(stateRoot, 'model-catalog.json'), 'utf8').catch(() => undefined);
    if (savedCatalog) {
      const source = JSON.parse(savedCatalog);
      getModelCatalogStore().saveSource(source.providerId, source);
      getModelRegistry().refresh();
    }
    const catalog = new AgentCatalogRepository(); catalog.ensureInitialized();
    const workspace = join(stateRoot, 'workspace');
    catalog.create({ id: 'windows-input-validation', workspace, models: { computerUse: { primary: modelRef } } } as any, { ready: true });
    const owner = createConversation({ agentId: 'windows-input-validation', sourceChannel: 'webchat' }, workspace).key;
    const frames = new Map<string, Uint8Array>();
    let modelInputs = 0, completedInputs = 0;
    const modelActions: string[] = [];
    const perform = driver.perform.bind(driver);
    driver.perform = async (target, action, signal) => {
      assert.equal(target.appId, allowedApp);
      assert.ok(['typeText', 'setValue', 'pressKeys', 'activate', 'click', 'wait'].includes(action.kind));
      if (action.kind === 'typeText' || action.kind === 'setValue') assert.equal(action.text, EXPECTED, 'Model may enter only the authorized synthetic text');
      modelInputs++; await perform(target, action, signal); completedInputs++; modelActions.push(action.kind);
    };
    const endpoints: any = {
      bindings: { get: () => undefined, resolve: () => undefined },
      registry: { get: () => ({ endpointId: 'windows-input-live', kind: 'desktop' }), getTool: () => ({ revision: 'windows-validation' }) },
      uploads: { takeComputerFrame: (id: string) => { const frame = frames.get(id); frames.delete(id); return frame; } },
      invocations: { invoke: async ({ arguments: raw }: any) => {
        const result = await broker.command(ComputerCommandSchema.parse(raw));
        const { frame, ...value } = result;
        const invocationId = randomUUID(); const content: any[] = [{ type: 'json', value }];
        if (frame) { frames.set(invocationId, frame.bytes); content.push({ type: 'file', fileId: invocationId, mimeType: frame.mimeType }); }
        return { invocationId, content };
      } },
    };
    const config = ConfigSchema.parse({ computer: { enabled: true, maxModelRequests: 12, maxActionsPerSession: 12 } });
    const runtime = new ComputerRuntime(endpoints, () => config, () => 'windows-input-live');
    const originalFetch = globalThis.fetch;
    const responses: Array<{ status: number; content: unknown }> = [];
    globalThis.fetch = async (url, init) => {
      const response = await originalFetch(url, init);
      if (String(url).endsWith('/chat/completions') && response.ok) {
        const body = await response.clone().json() as any;
        // Synthetic fixture only; never retain request headers or credentials.
        responses.push({ status: response.status, content: typeof body.choices?.[0]?.message?.content === 'string'
          ? body.choices[0].message.content.slice(0, 16_384) : null });
        console.log(JSON.stringify({ phase: 'model-response', status: response.status, responseBytes: JSON.stringify(responses.at(-1)).length }));
      }
      return response;
    };
    try {
      const apps = await runtime.execute(owner, { op: 'discover', query: 'XopcInputFixture' });
      assert.equal(apps.apps?.length, 1);
      let opened = await runtime.execute(owner, { op: 'open', appRef: apps.apps[0].appRef, mode: 'control', prepare: true });
      for (let count = 0; count < 300 && opened.status === 'pending_authorization'; count++) {
        await delay(100); opened = await runtime.execute(owner, { op: 'observe' });
      }
      assert.equal(opened.status, 'ready', opened.errorCode);
      console.log(`Windows input validation: real model ${modelRef}`);
      const goal = `In this disposable native test window, replace the Message field's existing sample with exactly ${JSON.stringify(EXPECTED)}, press the End key once in Message (the Keyboard label must show End), then click Verify once. Do not modify Protected input or Read only. Do not use a terminal or another app.`;
      const expect = { kind: 'text' as const, text: 'PASS: Windows input verified' };
      let result = await runtime.execute(owner, { op: 'run', goal, expect, maxActions: 6 });
      for (let attempt = 0; attempt < 8 && !result.verified && !result.errorCode; attempt++) {
        console.log(JSON.stringify({ phase: 'model-progress', status: result.status, errorCode: result.errorCode }));
        if (!['pending_action', 'action_complete', 'goal_limit', 'ready'].includes(result.status)) break;
        result = await runtime.execute(owner, { op: 'run', goal, expect, maxActions: 6 });
      }
      assert.equal(result.verified, true, JSON.stringify({ status: result.status, errorCode: result.errorCode, nextAction: result.nextAction }));
      const oracleResult = await readOracle();
      assert.equal(oracleResult.text, EXPECTED); assert.equal(oracleResult.validated, true);
      assert.equal(oracleResult.lastKey, 'End'); assert.equal(oracleResult.verifyClicks, 1);
      assert.equal(oracleResult.protectedLength, 0); assert.equal(oracleResult.readOnlyText, 'READ ONLY');
      const report = await runtime.execute(owner, { op: 'report' });
      assert.ok(report.report!.counters.modelRequests >= 3 && completedInputs >= 3 && completedInputs === modelInputs);
      assert.ok(modelActions.includes('pressKeys'), 'The real model must propose an actual keyboard action');
      const closed = await runtime.execute(owner, { op: 'close' }); assert.equal(closed.status, 'stopped');
      const evidence = { result: 'passed', platform: process.platform, arch: process.arch, driverVersion: '0.36.0', modelRef,
        windowsBuild: release(), electronVersion: process.versions.electron,
        validationBundleSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
        realModelRequests: report.report!.counters.modelRequests, completedModelInputs: completedInputs,
        modelActions, realModelKeyboardVerified: true, nonemptyFieldReplacementVerified: true,
        unicodeAndMultiline: true, setValueVerified: true, typeTextVerified: true, keyEndVerified: true, keyBackspaceVerified: true,
        passwordAndReadonlyRefused: true, fixtureOracleVerified: true, duplicateNativeInputsNotReplayed: true, stopped: true,
        durationMs: Date.now() - start, report: closed.report,
        scope: 'Real configured model -> ComputerRuntime -> in-process endpoint adapter -> real Broker/Cua/Windows -> native app oracle. No model stubs; no Gateway network or installer certification.' };
      await writeFile(join(dirname(stateRoot), 'result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(JSON.stringify({ result: 'passed', modelRef, requests: evidence.realModelRequests, completedInputs }));
    } finally {
      globalThis.fetch = originalFetch;
      await writeFile(join(dirname(stateRoot), 'synthetic-model-responses.json'), `${JSON.stringify(responses, null, 2)}\n`);
      await runtime.execute(owner, { op: 'close' }); for (const frame of frames.values()) frame.fill(0);
    }
  } finally { await broker.dispose(); closeXopcDatabase(); app.quit(); }
}
void main().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : error instanceof Error ? error.message : 'Validation failed'); app.exit(1); });
