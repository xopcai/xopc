import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ dialog: vi.fn(), close: vi.fn(), permissions: vi.fn(), on: vi.fn(), off: vi.fn(), foreground: true }));
vi.mock('@kit.AbilityKit', () => ({ abilityAccessCtrl: { createAtManager: () => ({ requestPermissionsFromUser: mocks.permissions }) } }));
vi.mock('@kit.ArkUI', () => ({}));
vi.mock('../entry/src/main/ets/service/deviceLocationConsent', () => ({ openDeviceLocationConsent: () => ({ answer: mocks.dialog().then((result: { index: number }) => result.index === 1), cancel: mocks.close }) }));
vi.mock('@kit.LocationKit', () => ({ geoLocationManager: { on: mocks.on, off: mocks.off, isLocationEnabled: () => true,
  LocationRequestPriority: { ACCURACY: 1, FIRST_FIX: 2 } } }));
vi.mock('../entry/src/main/ets/service/layoutState', () => ({ layoutState: mocks }));
import { attachDeviceLocation, invokeDeviceLocation, cancelDeviceLocation, cancelAllDeviceLocations } from '../entry/src/main/ets/service/deviceLocation';
import { DEVICE_TOOL_REVISIONS } from '../entry/src/main/ets/common/deviceToolCatalog';
function request(overrides = {}) { return { invocationId: 'once', descriptorRevision: DEVICE_TOOL_REVISIONS[2], confirmationRequired: false,
  arguments: { purpose: 'weather', precision: 'approximate' }, deadlineAt: Date.now() + 90000, ...overrides }; }
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mocks.foreground = true; mocks.dialog.mockResolvedValue({ index: 1 }); mocks.permissions.mockResolvedValue({ authResults: [0, 0] });
  attachDeviceLocation({} as any, { getPromptAction: () => ({ showDialog: mocks.dialog }) } as any); });
afterEach(() => { cancelAllDeviceLocations(); vi.useRealTimers(); });
describe('Harmony single-use location', () => {
  it('skips app confirmation, rounds approximate samples before upload and stops sensors', async () => {
    const send = vi.fn(); invokeDeviceLocation(request(), send); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.dialog).not.toHaveBeenCalled(); expect(mocks.permissions.mock.calls[0][1]).toEqual(['ohos.permission.APPROXIMATELY_LOCATION']);
    mocks.on.mock.calls[0][2]({ latitude: 31.234567, longitude: 121.456789, accuracy: 8, timeStamp: Date.now() });
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.result', { content: [{ value: { latitude: 31.24, longitude: 121.46, accuracyMeters: 3000, precision: 'approximate' } }] }]);
    expect(mocks.off).toHaveBeenCalledOnce();
    invokeDeviceLocation(request({ invocationId: 'second' }), send); await vi.advanceTimersByTimeAsync(0); expect(mocks.dialog).not.toHaveBeenCalled();
  });
  it('does not start location after cancellation during the OS permission request', async () => {
    const send = vi.fn();
    let grant: (result: { authResults: number[] }) => void = () => {};
    mocks.permissions.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
    invokeDeviceLocation(request(), send);
    cancelDeviceLocation('once');
    grant({ authResults: [0] });
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.cancelled', { invocationId: 'once' }]);
    expect(mocks.on).not.toHaveBeenCalled();
  });
  it('rejects missing foreground, expiry and permission denial; ignores stale callbacks', async () => {
    const send = vi.fn(); mocks.foreground = false; invokeDeviceLocation(request(), send);
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.error', { code: 'ENDPOINT_NOT_FOREGROUND' }]);
    mocks.foreground = true; invokeDeviceLocation(request({ deadlineAt: 0 }), send);
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.error', { code: 'TOOL_TIMEOUT' }]);
    mocks.permissions.mockResolvedValueOnce({ authResults: [-1] }); invokeDeviceLocation(request(), send); await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.error', { code: 'PERMISSION_DENIED' }]); expect(mocks.on).not.toHaveBeenCalled();
    invokeDeviceLocation(request(), send); await vi.advanceTimersByTimeAsync(0); const listener = mocks.on.mock.calls[0][2]; cancelDeviceLocation('once');
    listener({ latitude: 1, longitude: 2, accuracy: 8, timeStamp: Date.now() });
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.cancelled', { invocationId: 'once' }]);
  });
});
