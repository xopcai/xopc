import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { UIContext } from '@kit.ArkUI';
import { geoLocationManager } from '@kit.LocationKit';
import { DEVICE_TOOL_REVISIONS } from '../common/deviceToolCatalog';
import { layoutState } from './layoutState';
import { openDeviceLocationConsent, XopcLocationConsentHandle } from './deviceLocationConsent';

interface XopcLocationArgs { purpose: string; precision: string; category?: string; }
interface XopcLocationInvocation { invocationId: string; descriptorRevision: string; arguments: XopcLocationArgs; confirmationRequired: boolean; deadlineAt: number; }
interface XopcLocationSample { latitude: number; longitude: number; accuracyMeters: number; capturedAt: number; coordinateSystem: string; precision: string; }
interface XopcLocationContent { type: string; value: XopcLocationSample; }
interface XopcLocationResult { invocationId: string; content: XopcLocationContent[]; }
interface XopcLocationStatus { invocationId: string; code?: string; message?: string; }
interface XopcLocationPending { cancel: () => void; }
let xopcLocationContext: common.UIAbilityContext | undefined;
let xopcLocationUi: UIContext | undefined;
const xopcLocationPending: Map<string, XopcLocationPending> = new Map<string, XopcLocationPending>();
let xopcLocationConsentPending: boolean = false;
export function attachDeviceLocation(context: common.UIAbilityContext, ui: UIContext): void { xopcLocationContext = context; xopcLocationUi = ui; }
export function cancelDeviceLocation(id: string): void { xopcLocationPending.get(id)?.cancel(); }
export function cancelAllDeviceLocations(): void { xopcLocationPending.forEach((item: XopcLocationPending): void => { item.cancel(); }); }
export function invokeDeviceLocation(payload: Object, send: (kind: string, body: Object) => void): void {
  const request = payload as XopcLocationInvocation;
  const fail = (code: string): void => { const body: XopcLocationStatus = { invocationId: request.invocationId, code, message: 'Location request failed: ' + code }; send('tool.error', body); };
  const args = request.arguments;
  if (request.descriptorRevision !== DEVICE_TOOL_REVISIONS[2]) { fail('TOOL_REVISION_MISMATCH'); return; }
  if (!request.confirmationRequired || !args || (args.purpose !== 'weather' && args.purpose !== 'nearby')
    || (args.precision !== 'approximate' && args.precision !== 'precise') || Object.keys(args).length !== (args.purpose === 'weather' ? 2 : 3)
    || (args.purpose === 'nearby' && ['restaurant', 'cafe', 'pharmacy', 'park'].indexOf(args.category ?? '') < 0)) { fail('INVALID_ARGUMENTS'); return; }
  if (request.deadlineAt <= Date.now()) { fail('TOOL_TIMEOUT'); return; }
  if (!layoutState.foreground || !xopcLocationContext || !xopcLocationUi) { fail('ENDPOINT_NOT_FOREGROUND'); return; }
  if (xopcLocationPending.size || xopcLocationConsentPending) { fail('TOOL_BUSY'); return; }
  const received: XopcLocationStatus = { invocationId: request.invocationId }; send('tool.received', received);
  let alive: boolean = true;
  let consent: XopcLocationConsentHandle | undefined;
  let listener: ((sample: geoLocationManager.Location) => void) | undefined;
  const finish = (): void => {
    alive = false; clearTimeout(timer); xopcLocationPending.delete(request.invocationId);
    consent?.cancel();
    if (listener) { try { geoLocationManager.off('locationChange', listener); } catch (_) {} listener = undefined; }
  };
  const cancel = (): void => { if (!alive) return; finish(); const body: XopcLocationStatus = { invocationId: request.invocationId }; send('tool.cancelled', body); };
  const timer: number = setTimeout((): void => { if (!alive) return; finish(); fail('TOOL_TIMEOUT'); }, Math.min(90000, request.deadlineAt - Date.now()));
  xopcLocationPending.set(request.invocationId, { cancel });
  const work = async (): Promise<void> => {
    try {
      xopcLocationConsentPending = true;
      const service = args.purpose === 'weather' ? 'Open-Meteo' : 'OpenStreetMap';
      consent = openDeviceLocationConsent(xopcLocationUi!, '使用此设备的' + (args.precision === 'precise' ? '精确' : '大致') + '位置' + (args.purpose === 'weather' ? '查询天气' : '查询附近地点')
          + '。坐标将发送给 ' + service + '，仅用于本次查询，原始坐标不进入聊天历史。',
      );
      const answer: boolean = await consent.answer;
      xopcLocationConsentPending = false;
      if (!alive) return;
      if (!answer) { finish(); fail('USER_DENIED'); return; }
      if (!layoutState.foreground) { finish(); fail('ENDPOINT_NOT_FOREGROUND'); return; }
      const permissions: Permissions[] = args.precision === 'precise'
        ? ['ohos.permission.APPROXIMATELY_LOCATION', 'ohos.permission.LOCATION'] : ['ohos.permission.APPROXIMATELY_LOCATION'];
      xopcLocationConsentPending = true;
      const grant = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(xopcLocationContext!, permissions);
      xopcLocationConsentPending = false;
      if (!alive) return;
      if (grant.authResults[0] !== 0) { finish(); fail('PERMISSION_DENIED'); return; }
      if (!layoutState.foreground) { finish(); fail('ENDPOINT_NOT_FOREGROUND'); return; }
      if (!geoLocationManager.isLocationEnabled()) { finish(); fail('PERMISSION_DENIED'); return; }
      const precise: boolean = args.precision === 'precise' && grant.authResults[1] === 0;
      listener = (sample: geoLocationManager.Location): void => {
        if (!alive) return;
        if (!layoutState.foreground) { finish(); fail('ENDPOINT_NOT_FOREGROUND'); return; }
        if (sample.timeStamp < Date.now() - 30000 || sample.timeStamp > Date.now() + 60000 || sample.accuracy < 0) return;
        const approximate: boolean = !precise || sample.accuracy > 1000;
        const reading: XopcLocationSample = { latitude: approximate ? Math.round(sample.latitude * 50) / 50 : sample.latitude, longitude: approximate ? Math.round(sample.longitude * 50) / 50 : sample.longitude,
          accuracyMeters: approximate ? Math.max(3000, sample.accuracy) : sample.accuracy, capturedAt: sample.timeStamp, coordinateSystem: 'WGS84',
          precision: approximate ? 'approximate' : 'precise' };
        finish(); const result: XopcLocationResult = { invocationId: request.invocationId, content: [{ type: 'json', value: reading }] }; send('tool.result', result);
      };
      geoLocationManager.on('locationChange', { priority: precise ? geoLocationManager.LocationRequestPriority.ACCURACY : geoLocationManager.LocationRequestPriority.FIRST_FIX,
        timeInterval: 1, distanceInterval: 0, maxAccuracy: 0 }, listener);
    } catch (_) { xopcLocationConsentPending = false; if (alive) { finish(); fail('PERMISSION_DENIED'); } }
  };
  work();
}
