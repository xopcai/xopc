/** Opt-in hosted Computer Use check using xopc's own ChatGPT OAuth credentials. */
import '../src/infra/http-proxy-env.js';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { getApiKey, getProviderAuthState, resolveModel } from '../src/providers/index.js';
import { createComputerModelAdapter, predictComputerStep, readComputerResponsesStream } from '../src/computer/model-adapter.js';
import { computerModelProfile } from '../src/computer/model-policy.js';
import { computerDiagnostic } from '../src/computer/errors.js';

async function main() {
  if (process.argv.includes('--native')) {
    assert.equal(process.type, 'browser', 'Native validation must run in the Electron main process');
    assert.ok(process.env.XOPC_COMPUTER_DRIVER_BINARY, 'Pass the verified native driver binary');
    await (await import('electron')).app.whenReady();
  }
  console.error(JSON.stringify({ phase: 'oauth-check' }));
  const modelRef = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'openai/gpt-6.1-sol';
  const model = resolveModel(modelRef);
  assert.equal(model.provider, 'openai');
  assert.equal((await getProviderAuthState(model.provider)).authMode, 'oauth', 'Sign in with ChatGPT inside xopc first; this check never falls back to an API key');
  console.error(JSON.stringify({ phase: 'oauth-refresh' }));
  const apiKey = await getApiKey(model.provider);
  assert.ok(apiKey, 'ChatGPT OAuth credential unavailable');
  const profile = computerModelProfile(model);
  assert.ok(profile, 'Model must support Computer Use');
  console.error(JSON.stringify({ phase: 'fixture-image' }));
  const image = await sharp(Buffer.from('<svg width="800" height="600"><rect width="800" height="600" fill="white"/><rect x="300" y="250" width="200" height="80" rx="10" fill="#1769e0"/><text x="400" y="302" text-anchor="middle" font-size="28" fill="white">Continue</text></svg>')).png().toBuffer();
  let requests = 0;
  const adapter = createComputerModelAdapter({ modelId: model.id, api: model.api, baseUrl: model.baseUrl, apiKey, profile }, async (url, init) => {
    const response = await fetch(url, init);
    if (process.env.XOPC_COMPUTER_DIAGNOSTICS === '1' && response.ok) {
      const result = await readComputerResponsesStream(response, 128 * 1024) as { status?: string; output?: Array<{ type: string; name?: string; arguments?: string }> };
      console.error(JSON.stringify({ status: result.status, output: result.output?.map(item => ({ type: item.type, name: item.name, argumentBytes: item.arguments?.length })) }));
      return Response.json(result);
    }
    return response;
  });
  const native = process.argv.includes('--native');
  async function verifyNative() {
    const { app } = await import('electron');
    const { ComputerBroker } = await import('../src/computer/broker.js');
    const { CuaComputerDriver } = await import('../electron/computer/cua-driver.js');
    await app.whenReady();
    const driver = new CuaComputerDriver(process.env.XOPC_COMPUTER_DRIVER_BINARY!, 'com.github.Electron');
    const broker = new ComputerBroker(driver, { isVisible: () => true, requestApproval: async () => true }, { enabled: true });
    const owner = 'chatgpt-oauth-validation'; const sessionId = owner;
    try {
      console.error(JSON.stringify({ phase: 'native-discovery' }));
      const catalog = await broker.command({ op: 'discover', owner, sessionId, query: 'XopcComputerFixture' });
      assert.equal(catalog.apps?.length, 1, 'Start the disposable XopcComputerFixture app first');
      let opened = await broker.command({ op: 'open', owner, sessionId, appRef: catalog.apps[0].appRef, mode: 'control', prepare: false,
        model: { modelRef, profile: profile!, origin: new URL(model.baseUrl).origin, runtimeLocation: 'unknown' } });
      const deadline = Date.now() + 5000;
      while (opened.status === 'pending_authorization' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
        opened = await broker.command({ op: 'status', owner, sessionId });
      }
      assert.equal(opened.status, 'ready', opened.errorCode ?? 'Fixture authorization did not complete');
      await new Promise(resolve => setTimeout(resolve, 700));
      const captures: Array<{ target: string; digest: string }> = [];
      const observe = driver.observe.bind(driver);
      driver.observe = async (...args) => { const value = await observe(...args); captures.push({ target: JSON.stringify(value.target), digest: value.stateDigest }); return value; };
      const before = await broker.command({ op: 'observe', owner, sessionId });
      assert.equal(before.observation?.target.appId, 'ai.xopc.discovery-fixture');
      assert.ok(before.frame && before.observation);
      let proposal;
      try {
        proposal = await predictComputerStep(adapter, { image: before.frame.bytes, mimeType: before.frame.mimeType,
          width: before.observation.imageWidth, height: before.observation.imageHeight,
          summary: before.observation.summary, goal: 'Click the Continue button once, using the current native ref if available. This is a disposable test window.' }, () => { requests++; });
      } finally { before.frame.bytes.fill(0); }
      assert.equal(proposal.kind, 'action', 'Expected a grounded action for the fixture button');
      if (proposal.kind !== 'action') throw new Error('Expected action');
      assert.ok(proposal.action.kind === 'click' || proposal.action.kind === 'activate', 'Only a fixture button press may execute');
      const command = { op: 'act' as const, owner, sessionId, envelope: { actionId: owner, sessionId,
        observationId: before.observation.id, brokerEpoch: before.brokerEpoch, generation: before.generation,
        grantId: before.grantId!, deadlineAt: Date.now() + 120_000, action: proposal.action } };
      let after = await broker.command(command);
      if (after.status === 'pending_action') { await new Promise(resolve => setTimeout(resolve, 0)); after = await broker.command(command); }
      after.frame?.bytes.fill(0);
      console.error(JSON.stringify({ phase: 'native-receipt', errorCode: after.errorCode, dispatch: after.receipt?.dispatch, targetUnchanged: captures.length >= 2 && captures[0].target === captures[1].target, stateUnchanged: captures.length >= 2 && captures[0].digest === captures[1].digest }));
      assert.equal(after.receipt?.dispatch, 'completed', after.errorCode ?? 'Native input did not complete');
      assert.ok(after.observation?.summary.includes('PASS: Continue clicked'), 'Fixture did not confirm the click');
      return { nativeInputExecuted: true, nativeAction: proposal.action.kind, verifiedFixtureState: true };
    } finally { await broker.dispose(); }
  }

  const input = { image, mimeType: 'image/png' as const, width: 800, height: 600, summary: 'Synthetic fixture owned by this validation. No native input is executed.' };
  try {
    console.error(JSON.stringify({ phase: 'hosted-observation' }));
    const observation = await predictComputerStep(adapter, { ...input, goal: 'Read the label on the blue button.', readOnly: true }, () => { requests++; });
    assert.ok(observation.kind === 'answer' && /continue/i.test(observation.text), 'Visual recognition failed');
    console.error(JSON.stringify({ phase: 'hosted-action' }));
    const proposal = await predictComputerStep(adapter, { ...input, goal: 'Click the blue Continue button once. Use screenshot pixel coordinates.' }, () => { requests++; });
    assert.ok(proposal.kind === 'action' && proposal.action.kind === 'click', 'Model did not propose a click');
    assert.ok(proposal.action.point.x >= 300 && proposal.action.point.x < 500 && proposal.action.point.y >= 250 && proposal.action.point.y < 330, 'Click missed the fixture button');
    const nativeResult = native ? await verifyNative() : { nativeInputExecuted: false };
    console.log(JSON.stringify({ status: 'passed', modelRef, profile, auth: 'ChatGPT OAuth', requests, visualRecognition: true, groundedAction: true, ...nativeResult, personalScreenshots: false }));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', modelRef, requests, diagnostic: computerDiagnostic(error), error: error instanceof Error ? error.message.replaceAll(apiKey, '[redacted]') : 'Unknown failure', cause: error instanceof Error && error.cause instanceof Error ? error.cause.message.replaceAll(apiKey, '[redacted]') : undefined }));
    process.exitCode = 1;
  } finally { image.fill(0); }

}
// Do not await main at module scope: Electron emits ready after its entry module loads.
void main().catch(error => {
  console.error(JSON.stringify({ status: 'setup-failed', error: error instanceof assert.AssertionError ? error.message : error instanceof Error ? error.name : 'UnknownError' }));
  process.exitCode = 1;
}).finally(async () => {
  if (process.argv.includes('--native')) (await import('electron')).app.exit(process.exitCode ? Number(process.exitCode) : 0);
});
