import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { supported: vi.fn(), summary: vi.fn(), state: vi.fn(), control: vi.fn(), open: vi.fn(), close: vi.fn(), revision: 1, lastStream: undefined as { onFault: (code: string) => void } | undefined };
});
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({ XopcSecureStore: class { read = vi.fn(async () => undefined); write = vi.fn(async () => {}); } }));
vi.mock('@kit.ImageKit', () => ({ image: { createImageSource: vi.fn() } }));
vi.mock('../entry/src/main/ets/repository/phoneRepository.ets', () => ({ XopcPhoneRepository: class {
  supported = mocks.supported; summary = mocks.summary; state = mocks.state; control = mocks.control;
} }));
vi.mock('../entry/src/main/ets/service/phoneStream.ets', () => ({ XopcPhoneStream: class {
  onPhase = (_phase: string) => {}; onGeometry = () => {}; onFault = (_code: string) => {};
  constructor() { mocks.lastStream = this; }
  open = mocks.open; close = mocks.close; cancel() {} setSurface() {} pointer() {}
} }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  currentProfile: () => ({ gatewayId: 'gateway', deviceId: 'device' }), connectionRevision: () => mocks.revision, assertConnection: (revision: number) => { if (revision !== mocks.revision) throw new Error('Changed'); },
} }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error {} }));
import { XopcPhoneViewModel } from '../entry/src/main/ets/viewmodel/phoneViewModel.ets';
const binding = { conversationId: 'one', transcriptId: 'transcript', phoneSessionId: 'session', phoneDeviceId: 'cloud' };
const summary = { available: true, access: 'control', needsUser: false, binding };
const state = { report: { sessionId: 'session', controlEpoch: 1, status: 'running', mode: 'control' }, ownControl: false };
let model: XopcPhoneViewModel;
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.revision = 1;
  mocks.supported.mockResolvedValue(true); mocks.summary.mockResolvedValue(summary); mocks.state.mockResolvedValue(state);
  mocks.control.mockResolvedValue({ ...state, ownControl: false }); mocks.open.mockResolvedValue(undefined);
  model = new XopcPhoneViewModel();
});
afterEach(() => { model.dispose(); vi.useRealTimers(); });
it('discovers the icon without opening video or changing the selected page', async () => {
  model.bind('one', true, false); await settle();
  expect(model.summary?.available).toBe(true); expect(mocks.state).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  model.surface('surface'); model.bind('one', true, true); await settle();
  expect(mocks.open).toHaveBeenCalledOnce();
});
it('releases a takeover that finishes after paging back to chat', async () => {
  model.bind('one', true, true); await settle();
  let resolve!: (value: object) => void;
  mocks.control.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = model.command('takeover'); await settle();
  model.bind('one', true, false);
  resolve({ ...state, ownControl: true, report: { ...state.report, controlEpoch: 2 } });
  await pending;
  expect(mocks.control).toHaveBeenCalledTimes(2);
  expect(mocks.control.mock.calls.at(-1)?.[2]).toBe('release');
  expect(model.state?.ownControl).not.toBe(true);
});
it('ignores stale discovery responses after switching conversations', async () => {
  let resolve!: (value: object) => void;
  mocks.summary.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  model.bind('one', true, false); await settle();
  mocks.summary.mockResolvedValue({ available: false, access: 'control', needsUser: false });
  model.bind('two', true, false); await settle();
  resolve(summary); await settle();
  expect(model.summary?.available).toBe(false);
});
it('keeps restored assistance actionable without requesting a stale video session', async () => {
  mocks.state.mockResolvedValue({ ...state, report: { ...state.report, reconnectRequired: true, status: 'needs_user' } });
  model.bind('one', true, true); model.surface('surface'); await settle();
  expect(model.phase).toBe('restore'); expect(mocks.open).not.toHaveBeenCalled();
});
it('stops foreground work when the page or Gateway changes', async () => {
  model.bind('one', true, true); await settle(); const calls = mocks.summary.mock.calls.length;
  model.bind('one', false, false); await vi.advanceTimersByTimeAsync(10000);
  expect(mocks.summary).toHaveBeenCalledTimes(calls);
  mocks.revision++; model.bind('one', true, false); await settle();
  expect(mocks.supported).toHaveBeenCalledTimes(2);
});

it('does not mislabel a transient video disconnection as an unconfirmed phone operation', async () => {
  model.bind('one', true, true); await settle();
  mocks.lastStream?.onFault('PHONE_VIDEO_DISCONNECTED');
  expect(model.error).toBe('');
});
it('clears obsolete operation errors and pixels when phone access is withdrawn', async () => {
  model.bind('one', true, true); await settle(); model.error = 'PHONE_PERMISSION_REQUIRED';
  mocks.summary.mockResolvedValue({ available: true, access: 'none', needsUser: false });
  await model.refresh(); expect(model.error).toBe(''); expect(model.state).toBeUndefined(); expect(model.snapshot).toBeUndefined();
});

it('releases manual control and stops media and heartbeats when returning to chat', async () => {
  const human = { ...state, ownControl: true, report: { ...state.report, controlEpoch: 2, controlOwner: 'human' } };
  mocks.control.mockResolvedValue(human);
  model.bind('one', true, true); model.surface('surface'); await settle();
  await model.command('takeover');
  const opens = mocks.open.mock.calls.length;
  mocks.control.mockResolvedValue(state); mocks.state.mockResolvedValue(state);
  model.bind('one', true, false); await vi.advanceTimersByTimeAsync(20000);
  expect(model.state?.ownControl).not.toBe(true);
  expect(mocks.control.mock.calls.filter(call => call[2] === 'heartbeat')).toHaveLength(0);
  expect(mocks.control.mock.calls.filter(call => call[2] === 'release')).toHaveLength(1);
  expect(mocks.open).toHaveBeenCalledTimes(opens);
  model.bind('one', true, true); await settle();
  expect(model.state?.ownControl).toBe(false);
});
it('releases a pending takeover after switching to another conversation', async () => {
  model.bind('one', true, true); await settle();
  let resolve!: (value: object) => void;
  mocks.control.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = model.command('takeover'); await settle();
  model.bind('two', true, false); await settle();
  resolve({ ...state, ownControl: true }); await pending;
  expect(mocks.control).toHaveBeenLastCalledWith(binding, expect.objectContaining({ ownControl: true }), 'release');
});

it('marks an assistance request viewed only after loading visible phone state', async () => {
  mocks.summary.mockResolvedValue({ ...summary, needsUser: true, assistance: { id: 'wait', version: 1 } });
  model.bind('one', true, false); await settle();
  expect(model.needsAttention).toBe(true);
  model.bind('one', true, true); await settle();
  expect(model.needsAttention).toBe(false);
  model.bind('one', true, false); await settle();
  expect(model.needsAttention).toBe(false);
  mocks.summary.mockResolvedValue({ ...summary, needsUser: true, assistance: { id: 'new-wait', version: 1 } });
  await model.refresh(); await settle();
  expect(model.needsAttention).toBe(true);
});
