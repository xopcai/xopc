import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { current: vi.fn(), profiles: vi.fn(), restore: vi.fn(), pair: vi.fn(), activate: vi.fn(), rename: vi.fn(), remove: vi.fn(), cancel: vi.fn(),
    start: vi.fn(), reset: vi.fn(), pushReset: vi.fn(), disable: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  currentProfile: mocks.current, savedProfiles: mocks.profiles, restore: mocks.restore, pair: mocks.pair,
  activate: mocks.activate, renameProfile: mocks.rename, removeProfile: mocks.remove, cancelPairing: mocks.cancel,
} }));
vi.mock('../entry/src/main/ets/service/realtimeClient.ets', () => ({ realtimeClient: { start: mocks.start, reset: mocks.reset } }));
vi.mock('../entry/src/main/ets/service/pushNotifications.ets', () => ({ pushNotifications: {
  busy: false, enabled: false, reset: mocks.pushReset, disable: mocks.disable,
} }));
import { XopcConnectionViewModel } from '../entry/src/main/ets/viewmodel/connectionViewModel.ets';
const a = { gatewayId: 'a', name: 'Office' }; const b = { gatewayId: 'b', name: 'Home' };
describe('Gateway management orchestration', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.current.mockReturnValue(a); mocks.profiles.mockReturnValue([a, b]); });
  it('opens management outside the old home and returns with the saved connection', () => {
    const model = new XopcConnectionViewModel(); model.openGateways();
    expect(model.managing).toBe(true); expect(model.activeGatewayId).toBe('a'); expect(mocks.reset).toHaveBeenCalled();
    model.closeGateways(); expect(model.connected).toBe(true); expect(model.managing).toBe(false); expect(mocks.start).toHaveBeenCalled();
  });
  it('keeps existing profiles when adding is cancelled', async () => {
    const model = new XopcConnectionViewModel(); model.openGateways(); model.addGateway();
    expect(model.adding).toBe(true); await model.cancel();
    expect(model.managing).toBe(true); expect(model.adding).toBe(false); expect(model.profiles).toHaveLength(2);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('does not publish a failed switch and can return to the previous home', async () => {
    mocks.activate.mockRejectedValue(new Error('OFFLINE'));
    const model = new XopcConnectionViewModel(); model.openGateways(); await model.activate('b');
    expect(model.managing).toBe(true); expect(model.activeGatewayId).toBe('a'); expect(model.errorMessage).toBe('OFFLINE');
    model.closeGateways(); expect(mocks.start).toHaveBeenCalled(); expect(model.gatewayName).toBe('Office');
  });
  it('resets realtime before switching and remounts home only after success', async () => {
    mocks.activate.mockImplementation(async () => { mocks.current.mockReturnValue(b); });
    const model = new XopcConnectionViewModel(); model.openGateways(); await model.activate('b');
    expect(model.activeGatewayId).toBe('b'); expect(model.managing).toBe(false);
    expect(mocks.reset.mock.invocationCallOrder.at(-1)!).toBeLessThan(mocks.activate.mock.invocationCallOrder[0]);
    expect(mocks.start.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.activate.mock.invocationCallOrder[0]);
  });
  it('retains the add screen after a failed pairing and leaves the original profile intact', async () => {
    mocks.pair.mockRejectedValue(new Error('PAIRING_REJECTED'));
    const model = new XopcConnectionViewModel(); model.openGateways(); model.addGateway(); await model.connect('invitation');
    expect(model.adding).toBe(true); expect(model.connected).toBe(true); expect(model.activeGatewayId).toBe('a');
    expect(model.errorMessage).toBe('PAIRING_REJECTED'); expect(mocks.start).not.toHaveBeenCalled();
  });
});
