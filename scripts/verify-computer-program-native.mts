/** Real QuickJS -> shared runtime -> broker -> pinned native driver, fixture only. */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { app } from 'electron';
import { ComputerBroker } from '../src/computer/broker.js';
import { ComputerRuntime } from '../src/computer/runtime.js';
import { CuaComputerDriver } from '../electron/computer/cua-driver.js';
import { AgentCatalogRepository } from '../src/agent-catalog/repository.js';
import { AgentDefaultsSchema } from '../src/agent-config/index.js';
import { ConfigSchema } from '../src/config/schema.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { createConversation } from '../src/storage/sqlite/conversation-repository.js';
import { bindComputerAgentTurn, computerImagesForRequest, endComputerAgentTurn, setComputerProgramAuthorization } from '../src/computer/agent-context.js';
import { createComputerUseTool } from '../src/agent/tools/computer-use-tool.js';

async function main() {
  const [binary, output] = process.argv.slice(2);
  const root = dirname(output);
  await app.whenReady();
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const catalog = new AgentCatalogRepository();
  catalog.ensureInitialized(AgentDefaultsSchema.parse({ models: { chat: { primary: 'fixture/visual-main' } } }));
  catalog.create({ id: 'ui-program', workspace } as any, { ready: true });
  const owner = createConversation({ agentId: 'ui-program', sourceChannel: 'webchat' }, workspace).key;
  const driver = new CuaComputerDriver(binary, 'com.github.Electron');
  const broker = new ComputerBroker(driver, { isVisible: () => true, requestApproval: async () => true }, { enabled: true });
  const frames = new Map<string, Uint8Array>();
  let invocation = 0;
  const endpoint = { kind: 'desktop', endpointId: 'fixture-native', principalId: 'fixture-owner' };
  const endpoints = { bindings: { get: () => undefined }, registry: { get: () => endpoint, getTool: () => ({ revision: 'fixture-current' }) },
    uploads: { takeComputerFrame(id: string) { const value = frames.get(id); frames.delete(id); return value; } },
    invocations: { async invoke({ arguments: command }: any) {
      const result = await broker.command(command);
      const { frame, ...value } = result;
      const content: any[] = [{ type: 'json', value }];
      const id = String(++invocation);
      if (frame) { frames.set(id, frame.bytes); content.push({ type: 'file', fileId: id, mimeType: frame.mimeType }); }
      return { invocationId: id, content };
    } } };
  const runtime = new ComputerRuntime(endpoints as any, () => ConfigSchema.parse({ computer: { enabled: true } }), () => endpoint.endpointId);
  const tool = createComputerUseTool({ runtime, context: () => ({ conversationId: owner, runId: 'native-program' }) });
  const execute = (input: unknown, id = 'native-program-call') => tool.execute(id, input as any, new AbortController().signal);
  bindComputerAgentTurn(owner, 'native-program', { id: 'fixture-visual-main', provider: 'fixture', input: ['text', 'image'], baseUrl: 'https://fixture.invalid/v1' } as any);
  let authorized = 0, completed = 0;
  setComputerProgramAuthorization(owner, async () => { authorized++; }, async () => { completed++; });
  let evidence: Record<string, unknown>;
  try {
    const discovered = await execute({ op: 'discover', query: 'XopcInputBenchmark' });
    const apps = (discovered.details as any).apps;
    assert.equal(apps.length, 1);
    await execute({ op: 'open', appRef: apps[0].appRef, mode: 'control', prepare: false, planner: 'agent' });
    const started = performance.now();
    const program = await execute({ op: 'exec', code: `
      let s = await ui.observe({});
      const field = s.elements.find(e => e.role === 'AXTextField' && e.label === 'Benchmark text');
      if (!field) throw new Error('Fixture field missing');
      const edit = await ui.act({snapshotId:s.snapshotId, action:{kind:'setValue',ref:field.ref,text:'XOPC PROGRAM VERIFIED'},
        expect:{kind:'field',label:'Benchmark text',value:'XOPC PROGRAM VERIFIED'}});
      text(edit.verification);
      s = await ui.observe({});
      const button = s.elements.find(e => e.role === 'AXButton' && e.label === 'Increment');
      if (!button) throw new Error('Fixture button missing');
      await ui.act({snapshotId:s.snapshotId,action:{kind:'activate',ref:button.ref},expect:{kind:'text',text:'Input count 1'}});
      store('completedInputs', 2);
      await ui.observe({visual:true});
    ` });
    const elapsedMs = performance.now() - started;
    assert.equal((program.details as any).status, 'program_completed');
    const pixels = computerImagesForRequest(owner, 'native-program', 'native-program-call');
    assert.equal(pixels.length, 1);
    assert.ok(!JSON.stringify(program).includes('data:image'));
    // Fresh native read through a separate observation invocation, not the input receipt.
    const target = await driver.resolveTarget('ai.xopc.input-benchmark', new AbortController().signal, { prepare: false });
    const independent = await driver.observe(target, new AbortController().signal);
    independent.image.fill(0);
    const tree = JSON.parse(independent.summary);
    assert.ok(tree.elements.some((e: any) => e.label === 'Benchmark text' && e.value === 'XOPC PROGRAM VERIFIED'));
    assert.ok(tree.text.includes('Input count 1'));
    const resumed = await execute({ op: 'exec', code: `text(load('completedInputs'));` }, 'second-call');
    assert.equal((resumed.details as any).output, '2');
    const closed = await execute({ op: 'close' });
    const report = (closed.details as any).report;
    assert.equal(report.counters.modelRequests, 0);
    assert.equal(report.counters.completedInputs, 2);
    assert.equal(report.status, 'released');
    assert.equal(computerImagesForRequest(owner, 'native-program', 'native-program-call').length, 0);
    evidence = { summary: { status: 'passed', elapsedMs, completedInputs: 2, authorizedHostCalls: authorized,
      completedHostCalls: completed, independentFieldVerified: true, independentButtonVerified: true,
      jsonStateAcrossCalls: true, ephemeralScreenshotReturned: true, framesClearedOnClose: true,
      guiModelRequests: 0, mainModelRequests: 0, planner: 'synthetic script; no inference', transport: 'in-process endpoint adapter' }, report };
  } catch (error) {
    evidence = { summary: { status: 'failed', errorCode: error instanceof Error && /^COMPUTER_[A-Z_0-9]+$/.test(error.message) ? error.message : 'PROGRAM_NATIVE_VALIDATION_FAILED' } };
    console.error(error instanceof Error ? error.message : 'Native program failed');
    process.exitCode = 1;
  } finally {
    await runtime.shutdown(); await endComputerAgentTurn(owner, 'native-program'); await broker.dispose();
    for (const frame of frames.values()) frame.fill(0);
    closeXopcDatabase();
  }
  await writeFile(output, JSON.stringify(evidence!, null, 2), { mode: 0o600 });
  app.exit(process.exitCode ?? 0);
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Native program setup failed'); app.exit(1); });
