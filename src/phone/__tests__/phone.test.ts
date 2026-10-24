import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { AgentDefaultsSchema, resolveEffectiveAgentConfig } from '../../agent-config/index.js';
import { openXopcDatabase, closeXopcDatabase } from '../../storage/sqlite/connection.js';
import { validateModelsConfig } from '../../config/models-json.js';
import { parseAdbDevices, parseAndroidLayout, parsePhoneUi, type PhoneDriver } from '../adb-driver.js';
import { MOCK_PHONE_MODEL, PhoneActionSchema, type PhoneObservation, type PhoneDecision } from '../contracts.js';
import { MockPhoneModel, parseAutoGlmResponse, phoneModelProfile, type PhoneModelAdapter } from '../model-adapter.js';
import { PhoneRepository } from '../repository.js';
import { PhoneRuntime } from '../runtime.js';
import type { PhoneInteractiveProvider } from '../live-provider.js';
import { createPhoneUseTool } from '../../agent/tools/phone-use-tool.js';

beforeEach(() => { closeXopcDatabase(); openXopcDatabase({ path: ':memory:' }); });
afterEach(() => { vi.restoreAllMocks(); closeXopcDatabase(); });

function screen(texts = ['Settings']): PhoneObservation {
  return { frameId: randomUUID(), capturedAt: Date.now(), width: 1080, height: 2400, rotation: 0, package: 'com.android.settings', frame: Buffer.from('test-pixels'),
    elements: texts.map(text => ({ text, description: '', resourceId: 'android:id/title', bounds: [0, 200, 500, 400], clickable: true, password: false, focused: false })) };
}
function fixture(adapter: PhoneModelAdapter = new MockPhoneModel()) {
  const repository = new PhoneRepository();
  const device = repository.save({ serial: 'emulator-5554', name: 'Test phone', enabled: true, allowedApps: ['com.android.settings'] });
  repository.setDefault(device.id);
  let current = ['About emulated device'];
  const frames: Buffer[] = [];
  const driver: PhoneDriver = {
    discover: vi.fn(async () => [{ serial: device.serial, name: 'Emulator', state: 'device', emulator: true }]),
    observe: vi.fn(async () => { const observation = screen(current); frames.push(observation.frame); return observation; }),
    execute: vi.fn(async () => { current = ['Device name', 'Model & hardware']; }),
  };
  const runtime = new PhoneRuntime(repository, () => driver, async () => adapter);
  const context = { config: ConfigSchema.parse({ phone: { enabled: true } }), agentId: 'main', modelRef: MOCK_PHONE_MODEL };
  return { repository, runtime, driver, device, context, frames, setScreen: (texts: string[]) => { current = texts; } };
}

describe('phone model contracts', () => {
  it('inherits or overrides the dedicated route without affecting chat', () => {
    const defaults = AgentDefaultsSchema.parse({ models: { chat: { primary: 'chat/model' }, phoneUse: { primary: MOCK_PHONE_MODEL } } });
    const inherited = resolveEffectiveAgentConfig({ defaults, agent: { id: 'main', models: { phoneUse: null } } });
    expect(inherited.config.models.phoneUse?.primary).toBe(MOCK_PHONE_MODEL);
    expect(inherited.config.models.chat.primary).toBe('chat/model');
    expect(() => AgentDefaultsSchema.parse({ ...defaults, models: { ...defaults.models, phoneUse: { primary: MOCK_PHONE_MODEL, fallbacks: ['other/model'] } } })).toThrow();
  });
  it('requires an explicit phone profile, image input and a matching API', () => {
    const model = { api: 'openai-completions', input: ['text', 'image'], phoneUse: { profile: 'autoglm-phone-v1' } };
    expect(phoneModelProfile(model)).toBe('autoglm-phone-v1');
    expect(phoneModelProfile({ ...model, api: 'openai-responses' })).toBeUndefined();
    expect(phoneModelProfile({ ...model, input: ['text'] })).toBeUndefined();
    const result = validateModelsConfig({ providers: { phone: { baseUrl: 'https://example.com/v1', api: 'openai-completions', models: [{ id: 'bad', input: ['text'], phoneUse: model.phoneUse }] } } });
    expect(result.valid).toBe(false);
  });
  it('parses literal AutoGLM actions and rejects code, extra actions and malformed coordinates', () => {
    expect(parseAutoGlmResponse('<think>ignored</think><answer>do(action="Tap", element=[100, 200])</answer>', [])).toEqual({ kind: 'action', action: { type: 'tap', point: [100, 200] } });
    expect(parseAutoGlmResponse('do(action="Type", text="hello\\nworld")', [])).toEqual({ kind: 'action', action: { type: 'typeText', text: 'hello\nworld' } });
    expect(parseAutoGlmResponse("do(action='Launch', app='设置')", ['com.android.settings'])).toMatchObject({ action: { package: 'com.android.settings' } });
    for (const raw of ['do(action="Tap", element=[-1,5])', 'do(action="Tap", element=[1])', 'do(action="Tap", element=__import__("os"))', 'do(action="Back"); do(action="Home")', 'garbage', 'do(action="Shell", text="echo nope")']) expect(() => parseAutoGlmResponse(raw, [])).toThrow();
    expect(() => parseAutoGlmResponse('do(action="Launch", app="com.other.app")', ['com.android.settings'])).toThrow();
    expect(() => PhoneActionSchema.parse({ type: 'tap', point: [1001, 3] })).toThrow();
  });
  it('treats unescaped quotes in completion prose as bounded, unverified text', () => {
    expect(parseAutoGlmResponse('finish(message="已进入"关于手机"页面。Android version: 15")', []))
      .toEqual({ kind: 'complete', summary: '已进入"关于手机"页面。Android version: 15' });
    expect(parseAutoGlmResponse(`finish(message="${'x'.repeat(1200)}")`, [])).toEqual({ kind: 'complete', summary: 'x'.repeat(1000) });
    expect(() => parseAutoGlmResponse('finish(message="done"); do(action="Back")', [])).toThrow();
    expect(() => parseAutoGlmResponse('finish(message="done"); finish(message="again")', [])).toThrow();
    expect(() => parseAutoGlmResponse('do(action="Type", text="unescaped "quotes" here")', [])).toThrow();
  });
});

describe('phone runtime', () => {
  it('renews the human heartbeat while a slow input observation occupies the command queue', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      f.driver.capture = vi.fn(async () => screen([]));
      await f.runtime.execute('heartbeat', { op: 'open', mode: 'control' }, f.context);
      const id = f.runtime.status('heartbeat')!.sessionId;
      await f.runtime.liveControl('heartbeat', id, f.context, 'browser', { op: 'takeover', epoch: 1, operationId: randomUUID() });
      const frame = await f.runtime.liveFrame('heartbeat', id, f.context, new AbortController().signal); frame.frame.fill(0);
      let finish!: () => void;
      vi.mocked(f.driver.capture).mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve; }); return screen([]); });
      const input = f.runtime.liveControl('heartbeat', id, f.context, 'browser', { op: 'input', epoch: 2,
        operationId: randomUUID(), frameSeq: frame.seq, action: { type: 'back' } });
      await vi.advanceTimersByTimeAsync(12_000);
      await f.runtime.liveControl('heartbeat', id, f.context, 'browser', { op: 'heartbeat', epoch: 2, operationId: randomUUID() });
      await vi.advanceTimersByTimeAsync(6000); finish(); await input;
      expect(f.runtime.liveStatus('heartbeat', id, f.context, 'browser')).toMatchObject({ ownControl: true });
    } finally { await f.runtime.shutdown(); vi.useRealTimers(); }
  });
  it('keeps manual control when text is refused before any device input', async () => {
    const f = fixture();
    try {
      await f.runtime.execute('text', { op: 'open', mode: 'control' }, f.context);
      const id = f.runtime.status('text')!.sessionId;
      await f.runtime.liveControl('text', id, f.context, 'browser', { op: 'takeover', epoch: 1, operationId: randomUUID() });
      const frame = await f.runtime.liveFrame('text', id, f.context, new AbortController().signal); frame.frame.fill(0);
      await expect(f.runtime.liveControl('text', id, f.context, 'browser', { op: 'input', epoch: 2,
        operationId: randomUUID(), frameSeq: frame.seq, action: { type: 'typeText', text: 'test' } })).rejects.toMatchObject({ code: 'PHONE_INPUT_NOT_FOCUSED' });
      expect(f.runtime.liveStatus('text', id, f.context, 'browser')).toMatchObject({ ownControl: true, report: { status: 'paused', actions: 0 } });
      expect(f.driver.execute).not.toHaveBeenCalled();
    } finally { await f.runtime.shutdown(); }
  });
  it('shares one cloud video source across concurrent viewers and revokes input before handback', async () => {
    const f = fixture();
    const device = f.repository.save({ serial: 'cloud.example:10001', name: 'Cloud', enabled: true,
      allowedApps: ['com.android.settings'], connection: { kind: 'aliyun-adb', endpoint: 'cloud.example:10001', credentialId: randomUUID() } });
    vi.spyOn(f.runtime, 'driverFor').mockResolvedValue({ ...f.driver,
      discover: async () => [{ serial: device.serial, name: 'Cloud', state: 'device', emulator: false }] });
    const provider: PhoneInteractiveProvider = {
      descriptor: { kind: 'scrcpy-h264', protocolVersion: 1, continuousTouch: true, maxPointers: 1 },
      geometry: { width: 544, height: 960, version: 1, codec: '' }, foreground: vi.fn(async () => 'com.android.settings'),
      start: vi.fn(async () => {}), close: vi.fn(async () => {}), revoke: vi.fn(async () => {}),
      pointer: vi.fn(async () => {}), refresh: vi.fn(), subscribe: () => () => {},
    };
    const create = vi.spyOn(f.runtime.cloud, 'interactive').mockResolvedValue(provider as Awaited<ReturnType<typeof f.runtime.cloud.interactive>>);
    const context = { ...f.context, modelRef: 'phone-cloud/autoglm-phone' };
    try {
      await f.runtime.execute('cloud-chat', { op: 'open', deviceId: device.id, mode: 'control' }, context);
      const id = f.runtime.status('cloud-chat')!.sessionId;
      const [one, two] = await Promise.all([f.runtime.liveVideo('cloud-chat', id, context), f.runtime.liveVideo('cloud-chat', id, context)]);
      expect(one).toBe(two); expect(create).toHaveBeenCalledOnce(); expect(provider.start).toHaveBeenCalledOnce();
      await f.runtime.liveControl('cloud-chat', id, context, 'human', { op: 'takeover', epoch: 1, operationId: randomUUID() });
      await one.input('human', { type: 'pointer', phase: 'down', seq: 1, epoch: 2, geometry: 1, x: 500, y: 500 });
      await f.runtime.liveControl('cloud-chat', id, context, 'human', { op: 'handback', epoch: 2, operationId: randomUUID() });
      expect(provider.pointer).toHaveBeenCalledOnce(); expect(provider.revoke).toHaveBeenCalled();
      expect(f.runtime.status('cloud-chat')?.controlOwner).toBe('agent');
      expect(() => one.input('human', { type: 'pointer', phase: 'up', seq: 2, epoch: 2, geometry: 1, x: 500, y: 500 })).toThrow('Manual control');
    } finally { await f.runtime.shutdown(); }
  });
  it('exposes the same runtime through the Agent tool without returning screenshot bytes', async () => {
    const f = fixture();
    const tool = createPhoneUseTool({ runtime: f.runtime, context: () => ({ ...f.context, owner: 'agent-conversation' }) });
    const signal = new AbortController().signal;
    await tool.execute('open', { op: 'open', mode: 'control' }, signal);
    const result = await tool.execute('run', { op: 'run', goal: 'Test', scenario: 'settings-about' }, signal);
    expect(result.details).toMatchObject({ verified: true, mock: true });
    expect(JSON.stringify(result)).not.toContain('test-pixels');
    expect(JSON.stringify(result)).not.toContain('frameId');
    await tool.execute('close', { op: 'close' }, signal);
  });
  it('executes a guarded action, verifies new native evidence and clears every frame', async () => {
    const f = fixture();
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
    const report = await f.runtime.execute('one', { op: 'run', goal: 'Test settings', scenario: 'settings-about', maxActions: 6 }, f.context);
    expect(report).toMatchObject({ status: 'completed', verified: true, verificationLevel: 'ui', mock: true, actions: 1 });
    expect(f.driver.execute).toHaveBeenCalledOnce();
    expect(f.frames.every(frame => frame.every(byte => byte === 0))).toBe(true);
    expect(f.repository.history()[0].facts).toBeUndefined();
    await f.runtime.shutdown();
  });
  it('holds a running tool across takeover, rejects late predictions and resumes from fresh UI', async () => {
    let resolve!: (decision: PhoneDecision) => void;
    let started!: () => void;
    const predicting = new Promise<void>(done => { started = done; });
    const f = fixture({ predict: async () => { started(); return new Promise(done => { resolve = done; }); } });
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
    const id = f.runtime.status('one')!.sessionId;
    const running = f.runtime.execute('one', { op: 'run', goal: 'Read', scenario: 'settings-about', maxActions: 3 }, f.context);
    await predicting;
    const acquired = await f.runtime.liveControl('one', id, f.context, 'browser', { op: 'takeover', epoch: 1, operationId: randomUUID() });
    expect(acquired).toMatchObject({ ownControl: true, report: { controlOwner: 'human', status: 'paused' } });
    resolve({ kind: 'action', action: { type: 'tap', point: [200, 200] } });
    await Promise.resolve();
    expect(f.driver.execute).not.toHaveBeenCalled();
    const epoch = f.runtime.status('one')!.controlEpoch!;
    await expect(f.runtime.liveControl('one', id, f.context, 'other-browser', { op: 'takeover', epoch, operationId: randomUUID() })).rejects.toMatchObject({ code: 'PHONE_CONTROL_BUSY' });
    await expect(f.runtime.execute('one', { op: 'resume' }, f.context)).rejects.toMatchObject({ code: 'PHONE_PAUSED' });
    const frame = await f.runtime.liveFrame('one', id, f.context, new AbortController().signal);
    const input = { op: 'input' as const, epoch, operationId: randomUUID(), frameSeq: frame.seq, action: { type: 'back' as const } };
    await f.runtime.liveControl('one', id, f.context, 'browser', input);
    await f.runtime.liveControl('one', id, f.context, 'browser', input);
    expect(f.driver.execute).toHaveBeenCalledOnce();
    expect(f.runtime.status('one')!.steps[0]).toMatchObject({ action: 'back', actor: 'human' });
    await f.runtime.liveControl('one', id, f.context, 'browser', { op: 'handback', epoch, operationId: randomUUID() });
    expect(await running).toMatchObject({ verified: true, modelRequests: 1 });
    await expect(f.runtime.liveControl('one', id, f.context, 'browser', { ...input, operationId: randomUUID() })).rejects.toMatchObject({ code: 'PHONE_CONTROL_CHANGED' });
    frame.frame.fill(0); await f.runtime.shutdown();
  });
  it('does not grant takeover until an in-flight dispatch settles', async () => {
    const f = fixture({ predict: async () => ({ kind: 'action', action: { type: 'tap', point: [200, 200] } }) });
    let release!: () => void; let entered!: () => void;
    const dispatched = new Promise<void>(done => { entered = done; });
    vi.mocked(f.driver.execute).mockImplementation(async () => { entered(); await new Promise<void>(done => { release = done; }); });
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
    const id = f.runtime.status('one')!.sessionId;
    const operation = f.runtime.execute('one', { op: 'run', goal: 'Read', scenario: 'settings-about', maxActions: 1 }, f.context);
    await dispatched;
    const acquire = f.runtime.liveControl('one', id, f.context, 'browser', { op: 'takeover', epoch: 1, operationId: randomUUID() });
    await Promise.resolve(); await Promise.resolve();
    expect(f.runtime.liveStatus('one', id, f.context, 'browser')).toMatchObject({ ownControl: false, report: { handoff: 'acquiring' } });
    release(); expect(await acquire).toMatchObject({ ownControl: true });
    const epoch = f.runtime.status('one')!.controlEpoch!;
    await f.runtime.liveControl('one', id, f.context, 'browser', { op: 'release', epoch, operationId: randomUUID() });
    expect(f.runtime.status('one')).toMatchObject({ controlOwner: 'none', status: 'paused' });
    const rejected = expect(operation).rejects.toThrow();
    await f.runtime.stop('one', 'cancel'); await rejected; await f.runtime.shutdown();
  });
  it('denies stale frames and revokes manual input when the heartbeat expires', async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
      const id = f.runtime.status('one')!.sessionId;
      await f.runtime.liveControl('one', id, f.context, 'browser', { op: 'takeover', epoch: 1, operationId: randomUUID() });
      const epoch = f.runtime.status('one')!.controlEpoch!;
      const frame = await f.runtime.liveFrame('one', id, f.context, new AbortController().signal);
      await expect(f.runtime.liveControl('one', id, f.context, 'browser', { op: 'input', epoch, operationId: randomUUID(), frameSeq: frame.seq + 1, action: { type: 'tap', point: [100, 100] } })).rejects.toMatchObject({ code: 'PHONE_FRAME_STALE' });
      await vi.advanceTimersByTimeAsync(18_000);
      expect(f.runtime.liveStatus('one', id, f.context, 'browser')).toMatchObject({ ownControl: false, report: { status: 'paused', controlOwner: 'none', stopReason: 'control_disconnected' } });
      expect(f.driver.execute).not.toHaveBeenCalled();
      frame.frame.fill(0);
    } finally { await f.runtime.shutdown(); vi.useRealTimers(); }
  });
  it('waits for explicit handback after a real model requests user assistance', async () => {
    const predict = vi.fn(async () => ({ kind: 'needsUser' as const, reason: 'Confirm on the phone' }));
    const f = fixture({ predict }); const context = { ...f.context, modelRef: 'phone/model' };
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, context);
    const id = f.runtime.status('one')!.sessionId;
    const operation = f.runtime.execute('one', { op: 'run', goal: 'Read', expectText: 'Android version', maxActions: 3 }, context);
    await vi.waitFor(() => expect(f.runtime.status('one')?.status).toBe('needs_user'));
    expect(f.runtime.status('one')?.controlOwner).toBe('none');
    expect(predict).toHaveBeenCalledOnce();
    f.setScreen(['Android version', '15']);
    await f.runtime.liveControl('one', id, context, 'browser', { op: 'handback', epoch: f.runtime.status('one')!.controlEpoch!, operationId: randomUUID() });
    expect(await operation).toMatchObject({ verified: true, facts: ['Android version', '15'] });
    expect(predict).toHaveBeenCalledOnce(); await f.runtime.shutdown();
  });
  it('rejects an input when human control expires during its fresh observation', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
      const id = f.runtime.status('one')!.sessionId;
      await f.runtime.liveControl('one', id, f.context, 'browser', { op: 'takeover', epoch: 1, operationId: randomUUID() });
      const frame = await f.runtime.liveFrame('one', id, f.context, new AbortController().signal);
      let release!: () => void; let entered!: () => void;
      const observing = new Promise<void>(done => { entered = done; });
      vi.mocked(f.driver.observe).mockImplementationOnce(async () => { entered(); await new Promise<void>(done => { release = done; }); return screen(); });
      const operation = f.runtime.liveControl('one', id, f.context, 'browser', { op: 'input', epoch: 2, operationId: randomUUID(), frameSeq: frame.seq, action: { type: 'tap', point: [100, 100] } });
      const rejected = expect(operation).rejects.toMatchObject({ code: 'PHONE_CONTROL_CHANGED' });
      await observing; await vi.advanceTimersByTimeAsync(18_000); release(); await rejected;
      expect(f.driver.execute).not.toHaveBeenCalled(); frame.frame.fill(0);
    } finally { await f.runtime.shutdown(); vi.useRealTimers(); }
  });
  it('uses one shared lease across runtimes and Agents', async () => {
    const f = fixture();
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
    const other = new PhoneRuntime(f.repository, () => f.driver, async () => new MockPhoneModel());
    await expect(other.execute('two', { op: 'open', mode: 'control' }, f.context)).rejects.toMatchObject({ code: 'PHONE_DEVICE_BUSY' });
    await expect(other.execute('two', { op: 'open', mode: 'control' }, { ...f.context, agentId: 'other' })).rejects.toMatchObject({ code: 'PHONE_DEVICE_BUSY' });
    await f.runtime.stop('one', 'close');
    await other.execute('two', { op: 'open', mode: 'control' }, f.context);
    await other.shutdown();
  });
  it('rejects late model output after cancellation without injecting input', async () => {
    let resolve!: (decision: PhoneDecision) => void;
    let entered!: () => void;
    const started = new Promise<void>(done => { entered = done; });
    const f = fixture({ predict: async () => { entered(); return new Promise(done => { resolve = done; }); } });
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
    const operation = f.runtime.execute('one', { op: 'run', goal: 'Test', scenario: 'settings-about', maxActions: 1 }, f.context);
    const rejected = expect(operation).rejects.toMatchObject({ code: 'PHONE_CANCELLED' });
    await started;
    const stop = f.runtime.stop('one', 'cancel');
    resolve({ kind: 'action', action: { type: 'tap', point: [100, 200] } });
    await stop; await rejected;
    expect(f.driver.execute).not.toHaveBeenCalled();
    expect(f.runtime.status('one')?.status).toBe('cancelled');
  });
  it('rejects out-of-scope screens before sending them to a model', async () => {
    const predict = vi.fn(); const f = fixture({ predict });
    vi.mocked(f.driver.observe).mockImplementation(async () => ({ ...screen(), package: 'com.private.app' }));
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
    await expect(f.runtime.execute('one', { op: 'run', goal: 'Read', scenario: 'settings-about', maxActions: 1 }, f.context)).rejects.toMatchObject({ code: 'PHONE_APP_DENIED' });
    expect(predict).not.toHaveBeenCalled();
    expect(f.driver.execute).not.toHaveBeenCalled();
  });
  it('never treats a finish claim as verified evidence', async () => {
    const f = fixture({ predict: async () => ({ kind: 'complete', summary: 'Done' }) });
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
    expect(await f.runtime.execute('one', { op: 'run', goal: 'Test', scenario: 'settings-about', maxActions: 1 }, f.context)).toMatchObject({ verified: false, stopReason: 'model_finished_unverified' });
    await f.runtime.shutdown();
  });
  it('refuses input in observe mode and after device permission changes', async () => {
    const f = fixture();
    await f.runtime.execute('one', { op: 'open', mode: 'observe' }, f.context);
    await expect(f.runtime.execute('one', { op: 'step', goal: 'Test', maxActions: 1 }, f.context)).rejects.toMatchObject({ code: 'PHONE_OBSERVE_ONLY' });
    await f.runtime.stop('one', 'close');
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
    f.repository.save({ ...f.device, enabled: false }, f.device.id);
    await expect(f.runtime.execute('one', { op: 'observe' }, f.context)).rejects.toMatchObject({ code: 'PHONE_ACCESS_CHANGED' });
    await f.runtime.shutdown();
  });
  it('discards a stale coordinate proposal when the native layout changes', async () => {
    const predict = vi.fn(async () => ({ kind: 'action' as const, action: { type: 'tap' as const, point: [200, 300] } }));
    const f = fixture({ predict });
    let captures = 0;
    vi.mocked(f.driver.observe).mockImplementation(async () => {
      captures++;
      return screen(captures === 1 ? ['First layout'] : captures <= 3 ? ['New layout'] : ['Device name', 'Model']);
    });
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
    const report = await f.runtime.execute('one', { op: 'run', goal: 'Test', scenario: 'settings-about', maxActions: 2 }, f.context);
    expect(predict).toHaveBeenCalledTimes(2); expect(f.driver.execute).toHaveBeenCalledOnce();
    expect(report).toMatchObject({ verified: true, modelRequests: 2, actions: 1 });
    await f.runtime.shutdown();
  });
  it('does not retry an input whose dispatch outcome is unknown', async () => {
    const f = fixture(); vi.mocked(f.driver.execute).mockRejectedValue(new Error('Connection lost after input'));
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
    await expect(f.runtime.execute('one', { op: 'run', goal: 'Test', scenario: 'settings-about', maxActions: 6 }, f.context)).rejects.toThrow();
    expect(f.runtime.status('one')).toMatchObject({ status: 'outcome_unknown', verified: false, actions: 1 });
    await expect(f.runtime.execute('one', { op: 'run', goal: 'Test', scenario: 'settings-about', maxActions: 6 }, f.context)).rejects.toMatchObject({ code: 'PHONE_OPEN_REQUIRED' });
    expect(f.driver.execute).toHaveBeenCalledOnce();
  });
  it('does not issue blind mock gestures when native UI text is unavailable', async () => {
    const f = fixture(); f.setScreen([]);
    await f.runtime.execute('one', { op: 'open', mode: 'control' }, f.context);
    expect(await f.runtime.execute('one', { op: 'run', goal: 'Test', scenario: 'settings-about', maxActions: 6 }, f.context)).toMatchObject({ status: 'needs_user', verified: false });
    expect(f.driver.execute).not.toHaveBeenCalled(); await f.runtime.shutdown();
  });
});

describe('ADB observations', () => {
  it('distinguishes emulator, unauthorized phone and offline endpoints', () => {
    expect(parseAdbDevices('List of devices attached\nemulator-5554 device product:sdk model:Pixel_7\nUSB123 unauthorized\n10.0.0.1:5555 offline\n')).toEqual([
      { serial: 'emulator-5554', state: 'device', name: 'Pixel 7', emulator: true },
      { serial: 'USB123', state: 'unauthorized', name: 'USB123', emulator: false },
      { serial: '10.0.0.1:5555', state: 'offline', name: '10.0.0.1:5555', emulator: false },
    ]);
  });
  it('does not expose password fields through native text observations', () => {
    const nodes = parsePhoneUi('<?xml version="1.0"?><hierarchy><node text="secret" content-desc="password" password="true" focused="true" bounds="[0,0][100,50]"/><node text="About" bounds="[0,50][100,100]"/></hierarchy>');
    expect(nodes[0]).toMatchObject({ text: '', description: '', password: true });
    expect(nodes[1].text).toBe('About');
  });
  it('uses only the focused application from Android CLI output, excluding system notifications', () => {
    const elements = parseAndroidLayout(JSON.stringify([
      { type: 'SYSTEM', content: [{ text: 'private notification', bounds: '[0,0][100,30]' }] },
      { type: 'APPLICATION', focused: true, content: [
        { class: 'android.widget.EditText', text: 'secret', interactions: ['PASSWORD'], state: ['FOCUSED'], bounds: '[0,30][100,80]' },
        { text: 'About phone', bounds: '[0,80][100,120]' }, { text: 'Hidden', hidden: true, bounds: '[0,130][100,150]' },
      ] },
    ]));
    expect(elements).toHaveLength(2); expect(elements[0]).toMatchObject({ text: '', password: true, focused: true, editable: true });
    expect(elements[1].text).toBe('About phone');
  });
});

describe('phone access through tool policy', () => {
  it('lets another enabled Agent discover and open the default phone', async () => {
    const { runtime, device, context } = fixture();
    const other = { ...context, agentId: 'assistant' };
    expect(await runtime.execute('other-chat', { op: 'discover' }, other)).toMatchObject({ devices: [{ id: device.id }] });
    expect(await runtime.execute('other-chat', { op: 'open', mode: 'observe' }, other)).toMatchObject({ deviceId: device.id, agentId: 'assistant' });
    await runtime.shutdown();
  });
  it('denies discovery and opening when the phone tool is denied', async () => {
    const { runtime, context } = fixture();
    const denied = { ...context, toolDenied: true };
    await expect(runtime.execute('denied', { op: 'discover' }, denied)).rejects.toMatchObject({ code: 'PHONE_DISABLED' });
    await expect(runtime.execute('denied', { op: 'open', mode: 'observe' }, denied)).rejects.toMatchObject({ code: 'PHONE_DISABLED' });
    await runtime.shutdown();
  });
  it('keeps disabled phones unavailable', async () => {
    const { runtime, repository, device, context } = fixture();
    repository.save({ ...device, enabled: false }, device.id);
    expect(await runtime.execute('disabled', { op: 'discover' }, context)).toMatchObject({ devices: [] });
    await expect(runtime.execute('disabled', { op: 'open', mode: 'observe' }, context)).rejects.toMatchObject({ code: 'PHONE_DEVICE_DENIED' });
    await runtime.shutdown();
  });
});

describe('human preview fast path', () => {
  it('captures and taps without native UI dumps, invalidates old pixels and observes fully on handback', async () => {
    const f = fixture();
    f.driver.capture = vi.fn(async () => screen([]));
    await f.runtime.execute('fast', { op: 'open', mode: 'control' }, f.context);
    const id = f.runtime.status('fast')!.sessionId;
    await f.runtime.liveControl('fast', id, f.context, 'browser', { op: 'takeover', epoch: 1, operationId: randomUUID() });
    vi.mocked(f.driver.observe).mockClear();
    const frame = await f.runtime.liveFrame('fast', id, f.context, new AbortController().signal);
    await f.runtime.liveControl('fast', id, f.context, 'browser', { op: 'input', epoch: 2, operationId: randomUUID(), frameSeq: frame.seq, action: { type: 'tap', point: [200, 200] } });
    expect(f.driver.observe).not.toHaveBeenCalled();
    expect(f.driver.execute).toHaveBeenCalledWith(f.device.serial, expect.objectContaining({ type: 'tap' }), expect.anything(), expect.any(AbortSignal), { settleMs: 0 });
    expect(f.runtime.liveStatus('fast', id, f.context, 'browser').frame).toBeNull();
    const after = await f.runtime.liveFrame('fast', id, f.context, new AbortController().signal);
    expect(after.seq).toBeGreaterThan(frame.seq);
    await f.runtime.liveControl('fast', id, f.context, 'browser', { op: 'handback', epoch: 2, operationId: randomUUID() });
    expect(f.driver.observe).toHaveBeenCalledTimes(1);
    frame.frame.fill(0); after.frame.fill(0); await f.runtime.shutdown();
  });
  it('collects native field metadata before text injection', async () => {
    const f = fixture(); f.driver.capture = vi.fn(async () => screen([]));
    vi.mocked(f.driver.observe).mockImplementation(async () => ({ ...screen([]), elements: [{ text: '', description: '', resourceId: 'field',
      bounds: [0, 0, 100, 100], clickable: true, focused: true, editable: true, password: false }] }));
    await f.runtime.execute('text', { op: 'open', mode: 'control' }, f.context);
    const id = f.runtime.status('text')!.sessionId;
    await f.runtime.liveControl('text', id, f.context, 'browser', { op: 'takeover', epoch: 1, operationId: randomUUID() });
    vi.mocked(f.driver.observe).mockClear();
    const frame = await f.runtime.liveFrame('text', id, f.context, new AbortController().signal);
    await f.runtime.liveControl('text', id, f.context, 'browser', { op: 'input', epoch: 2, operationId: randomUUID(), frameSeq: frame.seq, action: { type: 'typeText', text: 'test' } });
    expect(f.driver.observe).toHaveBeenCalledTimes(1);
    frame.frame.fill(0); await f.runtime.shutdown();
  });
  it('refuses fast frames outside the allowed application and zeroes their pixels', async () => {
    const f = fixture(); const denied = { ...screen([]), package: 'other.app' };
    f.driver.capture = vi.fn(async () => denied);
    await f.runtime.execute('denied', { op: 'open', mode: 'control' }, f.context);
    const id = f.runtime.status('denied')!.sessionId;
    await expect(f.runtime.liveFrame('denied', id, f.context, new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_APP_DENIED' });
    expect(denied.frame.every(byte => byte === 0)).toBe(true);
    expect(f.runtime.liveStatus('denied', id, f.context, 'browser').frame).toBeNull();
    await f.runtime.shutdown();
  });
});

it('recovers to an allowed application without exposing refused pixels or granting arbitrary launches', async () => {
  const f = fixture(); const refused = { ...screen([]), package: 'settings.search' };
  f.driver.capture = vi.fn(async () => refused);
  await f.runtime.execute('recover', { op: 'open', mode: 'control' }, f.context);
  const id = f.runtime.status('recover')!.sessionId;
  await f.runtime.liveControl('recover', id, f.context, 'browser', { op: 'takeover', epoch: 1, operationId: randomUUID() });
  await expect(f.runtime.liveFrame('recover', id, f.context, new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_APP_DENIED' });
  await expect(f.runtime.liveControl('recover', id, f.context, 'browser', { op: 'recover', epoch: 2, operationId: randomUUID(), action: { type: 'launch', package: 'other.app' } })).rejects.toMatchObject({ code: 'PHONE_APP_DENIED' });
  expect(f.driver.execute).not.toHaveBeenCalled();
  await f.runtime.liveControl('recover', id, f.context, 'browser', { op: 'recover', epoch: 2, operationId: randomUUID(), action: { type: 'launch', package: 'com.android.settings' } });
  expect(f.driver.execute).toHaveBeenCalledWith(f.device.serial, { type: 'launch', package: 'com.android.settings' }, expect.anything(), expect.any(AbortSignal), { settleMs: 0, resetTask: true });
  expect(refused.frame.every(byte => byte === 0)).toBe(true);
  expect(f.runtime.liveStatus('recover', id, f.context, 'browser').frame).toBeNull();
  await f.runtime.shutdown();
});

it('returns a complete live state when cancelling so the chat panel can render its terminal state', async () => {
  const f = fixture(); await f.runtime.execute('cancel-view', { op: 'open', mode: 'control' }, f.context);
  const id = f.runtime.status('cancel-view')!.sessionId;
  const result = await f.runtime.liveControl('cancel-view', id, f.context, 'browser', { op: 'cancel', epoch: 1, operationId: randomUUID() });
  expect(result).toMatchObject({ report: { sessionId: id, status: 'cancelled', deviceName: 'Test phone' }, ownControl: false, frame: null });
  await f.runtime.shutdown();
});

it('keeps manual input outside the Agent action budget', async () => {
  const f = fixture({ predict: async () => ({ kind: 'action', action: { type: 'back' } }) });
  f.context.config.phone.maxActionsPerSession = 1;
  await f.runtime.execute('budget', { op: 'open', mode: 'control' }, f.context);
  const id = f.runtime.status('budget')!.sessionId;
  await f.runtime.liveControl('budget', id, f.context, 'human', { op: 'takeover', epoch: 1, operationId: randomUUID() });
  const epoch = f.runtime.status('budget')!.controlEpoch!;
  for (let i = 0; i < 3; i++) {
    const frame = await f.runtime.liveFrame('budget', id, f.context, new AbortController().signal);
    await f.runtime.liveControl('budget', id, f.context, 'human', { op: 'input', epoch, operationId: randomUUID(), frameSeq: frame.seq, action: { type: 'back' } });
    frame.frame.fill(0);
  }
  await f.runtime.liveControl('budget', id, f.context, 'human', { op: 'handback', epoch, operationId: randomUUID() });
  f.setScreen(['Settings']);
  await f.runtime.execute('budget', { op: 'step', goal: 'Read Settings', scenario: 'settings-about' }, f.context);
  expect(f.runtime.status('budget')).toMatchObject({ actions: 4, humanActions: 3 });
  await f.runtime.shutdown();
});

it('finishes a slow real-model goal beyond the old 90-second limit', async () => {
  vi.useFakeTimers();
  const f = fixture({ predict: async (_input, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ kind: 'action', action: { type: 'back' } }), 100_000);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }) });
  const context = { ...f.context, modelRef: 'phone/real' };
  try {
    await f.runtime.execute('slow', { op: 'open', mode: 'control' }, context);
    const operation = f.runtime.execute('slow', { op: 'step', goal: 'Go back' }, context);
    await vi.advanceTimersByTimeAsync(100_001);
    expect(await operation).toMatchObject({ status: 'ready', actions: 1, stopReason: 'action_limit' });
  } finally { await f.runtime.shutdown(); vi.useRealTimers(); }
});

it('pauses a timed-out goal with facts intact and permits explicit handback without reopening', async () => {
  vi.useFakeTimers();
  const f = fixture({ predict: async (_input, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  f.context.config.phone.maxOperationDurationMs = 1000;
  try {
    await f.runtime.execute('deadline', { op: 'open', mode: 'control' }, f.context);
    const id = f.runtime.status('deadline')!.sessionId;
    const operation = f.runtime.execute('deadline', { op: 'run', goal: 'Read', scenario: 'settings-about' }, f.context);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await operation).toMatchObject({ sessionId: id, status: 'paused', controlOwner: 'none',
      errorCode: 'PHONE_OPERATION_TIMEOUT', stopReason: 'operation_timeout', verified: false, facts: ['About emulated device'] });
    expect(f.driver.execute).not.toHaveBeenCalled();
    await f.runtime.liveControl('deadline', id, f.context, 'browser', { op: 'handback', epoch: f.runtime.status('deadline')!.controlEpoch!, operationId: randomUUID() });
    expect(await f.runtime.execute('deadline', { op: 'observe' }, f.context)).toMatchObject({ sessionId: id, status: 'ready' });
  } finally { await f.runtime.shutdown(); vi.useRealTimers(); }
});

it('retains outcome_unknown if the deadline occurs inside a device dispatch', async () => {
  vi.useFakeTimers();
  const f = fixture({ predict: async () => ({ kind: 'action', action: { type: 'back' } }) });
  f.context.config.phone.maxOperationDurationMs = 1000;
  vi.mocked(f.driver.execute).mockImplementation(async (_serial, _action, _observation, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  try {
    await f.runtime.execute('unknown-deadline', { op: 'open', mode: 'control' }, f.context);
    const operation = f.runtime.execute('unknown-deadline', { op: 'step', goal: 'Back', scenario: 'settings-about' }, f.context);
    const rejected = expect(operation).rejects.toMatchObject({ code: 'PHONE_OPERATION_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1001); await rejected;
    expect(f.runtime.status('unknown-deadline')).toMatchObject({ status: 'outcome_unknown', stopReason: 'inspect_before_retry', steps: [{ dispatch: 'unknown' }] });
    expect(f.driver.execute).toHaveBeenCalledOnce();
  } finally { await f.runtime.shutdown(); vi.useRealTimers(); }
});

it('can hand back directly after tool pause without reusing the aborted operation signal', async () => {
  const f = fixture();
  try {
    await f.runtime.execute('paused-tool', { op: 'open', mode: 'control' }, f.context);
    await f.runtime.execute('paused-tool', { op: 'pause' }, f.context);
    const report = f.runtime.status('paused-tool')!;
    const result = await f.runtime.liveControl('paused-tool', report.sessionId, f.context, 'browser', { op: 'handback', epoch: report.controlEpoch!, operationId: randomUUID() });
    expect(result).toMatchObject({ report: { status: 'ready', controlOwner: 'agent', handoff: 'idle' }, resumeTurnRequired: true });
    expect(await f.runtime.execute('paused-tool', { op: 'observe' }, f.context)).toMatchObject({ status: 'ready' });
  } finally { await f.runtime.shutdown(); }
});

it('preserves explicit caller cancellation instead of reporting an operation deadline', async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const f = fixture({ predict: async (_input, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started();
  }) });
  const controller = new AbortController();
  try {
    await f.runtime.execute('user-cancel', { op: 'open', mode: 'control' }, f.context);
    const operation = f.runtime.execute('user-cancel', { op: 'step', goal: 'Read', scenario: 'settings-about' }, f.context, controller.signal);
    const rejected = expect(operation).rejects.toMatchObject({ code: 'PHONE_CANCELLED' });
    await ready; controller.abort(); await rejected;
    expect(f.runtime.status('user-cancel')).toMatchObject({ status: 'cancelled', errorCode: 'PHONE_CANCELLED' });
  } finally { await f.runtime.shutdown(); }
});

it('does not leave control stuck in returning when the handback observation fails', async () => {
  const f = fixture();
  try {
    await f.runtime.execute('handback-failure', { op: 'open', mode: 'control' }, f.context);
    await f.runtime.execute('handback-failure', { op: 'pause' }, f.context);
    const report = f.runtime.status('handback-failure')!;
    vi.mocked(f.driver.observe).mockRejectedValueOnce(new Error('Observation unavailable'));
    await expect(f.runtime.liveControl('handback-failure', report.sessionId, f.context, 'browser',
      { op: 'handback', epoch: report.controlEpoch!, operationId: randomUUID() })).rejects.toThrow('Observation unavailable');
    expect(f.runtime.status('handback-failure')).toMatchObject({ status: 'paused', controlOwner: 'none', handoff: 'idle' });
    expect(await f.runtime.liveControl('handback-failure', report.sessionId, f.context, 'browser',
      { op: 'handback', epoch: f.runtime.status('handback-failure')!.controlEpoch!, operationId: randomUUID() }))
      .toMatchObject({ report: { status: 'ready', controlOwner: 'agent', handoff: 'idle' } });
  } finally { await f.runtime.shutdown(); }
});

it('permits Home and cross-app observation only for all-app devices', async () => {
  const f = fixture({ predict: async () => ({ kind: 'action', action: { type: 'home' } }) });
  f.repository.save({ ...f.device, appAccess: 'all', allowedApps: [] }, f.device.id);
  try {
    await f.runtime.execute('all-apps', { op: 'open', mode: 'control' }, f.context);
    await f.runtime.execute('all-apps', { op: 'step', goal: 'Go home', scenario: 'settings-about' }, f.context);
    expect(f.driver.execute).toHaveBeenCalledWith(f.device.serial, { type: 'home' }, expect.any(Object), expect.any(AbortSignal), undefined);
    vi.mocked(f.driver.observe).mockImplementation(async () => ({ ...screen(['Clock']), package: 'com.android.deskclock' }));
    const observation = await f.runtime.previewSession('all-apps', f.context, new AbortController().signal); observation.frame.fill(0);
    await f.runtime.stop('all-apps', 'close');
    f.repository.save({ ...f.device, appAccess: 'selected', allowedApps: ['com.android.settings'] }, f.device.id);
    await f.runtime.execute('selected-apps', { op: 'open', mode: 'control' }, f.context);
    await expect(f.runtime.previewSession('selected-apps', f.context, new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_APP_DENIED' });
  } finally { await f.runtime.shutdown(); }
});
