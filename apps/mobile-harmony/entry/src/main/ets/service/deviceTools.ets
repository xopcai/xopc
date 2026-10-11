import { batteryInfo, deviceInfo } from '@kit.BasicServicesKit';
import { i18n } from '@kit.LocalizationKit';
import { invokeDeviceLocation } from './deviceLocation';
import { DEVICE_STATE_TOOL_CATALOG_JSON, DEVICE_TOOL_CATALOG_JSON, DEVICE_TOOL_REVISIONS } from '../common/deviceToolCatalog';

interface DeviceInvocation {
  invocationId: string; toolName: string; arguments: Object; descriptorRevision: string;
  confirmationRequired: boolean; deadlineAt: number;
}
interface DeviceState { capturedAt: number; platform: string; systemVersion: string; locale: string; timezone: string; }
interface DevicePower { capturedAt: number; levelPercent: number | null; charging: boolean | null; }
interface Reading { type: string; value: DeviceState | DevicePower; }
interface DeviceResult { invocationId: string; content: Reading[]; }
interface DeviceError { invocationId: string; code: string; message: string; }
interface DeviceReceived { invocationId: string; }

export function deviceToolCatalog(location: boolean = false): Object[] { return JSON.parse(location ? DEVICE_TOOL_CATALOG_JSON : DEVICE_STATE_TOOL_CATALOG_JSON) as Object[]; }

export function invokeDeviceTool(payload: Object, send: (kind: string, body: Object) => void): void {
  const request = payload as DeviceInvocation;
  const fail = (code: string): void => {
    const error: DeviceError = { invocationId: request.invocationId, code, message: 'Device reading unavailable: ' + code };
    send('tool.error', error);
  };
  if (request.toolName === 'mobile.device.get_location') { invokeDeviceLocation(payload, send); return; }
  const index = request.toolName === 'mobile.device.get_state' ? 0 : request.toolName === 'mobile.device.get_power' ? 1 : -1;
  if (index < 0) { fail('TOOL_NOT_FOUND'); return; }
  if (request.descriptorRevision !== DEVICE_TOOL_REVISIONS[index]) { fail('TOOL_REVISION_MISMATCH'); return; }
  if (request.confirmationRequired || !request.arguments || Object.keys(request.arguments).length !== 0) { fail('INVALID_ARGUMENTS'); return; }
  if (request.deadlineAt <= Date.now()) { fail('TOOL_TIMEOUT'); return; }
  const received: DeviceReceived = { invocationId: request.invocationId }; send('tool.received', received);
  try {
    let value: DeviceState | DevicePower;
    if (index === 0) {
      value = { capturedAt: Date.now(), platform: 'harmonyos', systemVersion: deviceInfo.displayVersion.slice(0, 80),
        locale: i18n.System.getSystemLocale(), timezone: i18n.getTimeZone().getID() };
    } else {
      const level = batteryInfo.batterySOC;
      const status = batteryInfo.chargingStatus;
      value = { capturedAt: Date.now(), levelPercent: batteryInfo.isBatteryPresent && level >= 0 && level <= 100 ? level : null,
        charging: status === batteryInfo.BatteryChargeState.NONE ? null
          : status === batteryInfo.BatteryChargeState.ENABLE || status === batteryInfo.BatteryChargeState.FULL };
    }
    if (request.deadlineAt <= Date.now()) { fail('TOOL_TIMEOUT'); return; }
    const result: DeviceResult = { invocationId: request.invocationId, content: [{ type: 'json', value }] };
    send('tool.result', result);
  } catch (_) { fail('PERMISSION_DENIED'); }
}
