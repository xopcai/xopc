import { describe, expect, it, vi } from 'vitest';
import { DEVICE_TOOL_REVISIONS } from '../entry/src/main/ets/common/deviceToolCatalog';
import { deviceToolCatalog, invokeDeviceTool } from '../entry/src/main/ets/service/deviceTools';
import { deviceStateDescriptor, canonicalJson } from '../../../packages/endpoint-tools-protocol/src/index';

const battery = vi.hoisted(() => ({ batterySOC: 0, isBatteryPresent: true, chargingStatus: 2,
  BatteryChargeState: { NONE: 0, ENABLE: 1, DISABLE: 2, FULL: 3 } }));
vi.mock('../entry/src/main/ets/service/deviceLocation.ets', () => ({ invokeDeviceLocation: vi.fn(), cancelDeviceLocation: vi.fn(), cancelAllDeviceLocations: vi.fn() }));
vi.mock('@kit.BasicServicesKit', () => ({ batteryInfo: battery, deviceInfo: { displayVersion: '6.0' } }));
vi.mock('@kit.LocalizationKit', () => ({ i18n: { System: { getSystemLocale: () => 'zh-CN' }, getTimeZone: () => ({ getID: () => 'Asia/Shanghai' }) } }));

function invocation(overrides: object = {}) {
  return { invocationId: 'invocation', toolName: 'mobile.device.get_power', descriptorRevision: DEVICE_TOOL_REVISIONS[1],
    arguments: {}, confirmationRequired: false, deadlineAt: Date.now() + 10_000, ...overrides };
}

describe('native device readings', () => {
  it('registers exactly the shared trusted contracts', () => {
    expect(canonicalJson(deviceToolCatalog())).toBe(canonicalJson([
      deviceStateDescriptor('mobile', 'state'), deviceStateDescriptor('mobile', 'power'),
    ]));
  });
  it('returns an actual zero battery level and null when the battery is absent', () => {
    const send = vi.fn();
    invokeDeviceTool(invocation(), send);
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.result', { content: [{ value: { levelPercent: 0, charging: false } }] }]);
    battery.isBatteryPresent = false;
    invokeDeviceTool(invocation(), send);
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.result', { content: [{ value: { levelPercent: null } }] }]);
    battery.isBatteryPresent = true;
  });
  it.each([
    [{ descriptorRevision: 'old' }, 'TOOL_REVISION_MISMATCH'],
    [{ toolName: 'mobile.files.read' }, 'TOOL_NOT_FOUND'],
    [{ arguments: { includeContacts: true } }, 'INVALID_ARGUMENTS'],
    [{ confirmationRequired: true }, 'INVALID_ARGUMENTS'],
    [{ deadlineAt: 0 }, 'TOOL_TIMEOUT'],
  ])('refuses unavailable or altered calls before sampling', (override, code) => {
    const send = vi.fn(); invokeDeviceTool(invocation(override), send);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('tool.error', expect.objectContaining({ code }));
  });
});
