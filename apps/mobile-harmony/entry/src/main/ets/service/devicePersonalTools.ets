import { signedHttpRequest } from './requestProof';
import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { UIContext } from '@kit.ArkUI';
import { util } from '@kit.ArkTS';
import { contact } from '@kit.ContactsKit';
import { calendarManager } from '@kit.CalendarKit';
import { i18n } from '@kit.LocalizationKit';
import { http } from '@kit.NetworkKit';
import { DEVICE_TOOL_REVISIONS } from '../common/deviceToolCatalog';
import { XopcChatAttachment } from '../model/chat';
import { layoutState } from './layoutState';
import { gatewaySession } from './gatewaySession';
import { pickChatAttachment } from './chatAttachmentPicker';
import { pickChatPhoto } from './chatPhotoPicker';
import { openDeviceLocationConsent, XopcLocationConsentHandle } from './deviceLocationConsent';

interface XopcPersonalArgs { field?: string; startAt?: number; endAt?: number; }
interface XopcPersonalGrant { path: string; token: string; maxBytes: number; expiresAt: number; }
interface XopcPersonalInvocation { invocationId: string; toolName: string; arguments: XopcPersonalArgs; descriptorRevision: string; confirmationRequired: boolean; deadlineAt: number; uploadGrant?: XopcPersonalGrant; }
interface XopcPersonalStatus { invocationId: string; code?: string; message?: string; }
interface XopcPersonalContact { id: string; name: string; phones: string[]; emails: string[]; }
interface XopcPersonalEvent { startAt: number; endAt: number; allDay: boolean; busy: boolean; title?: string; }
interface XopcPersonalCalendar { capturedAt: number; startAt: number; endAt: number; timeZone: string; accessScope: string; truncated: boolean; events: XopcPersonalEvent[]; }
interface XopcPersonalJson { type: string; value: XopcPersonalContact | XopcPersonalCalendar; }
interface XopcPersonalFile { type: string; fileId: string; name: string; mimeType: string; size: number; sha256: string; }
interface XopcPersonalFileEnvelope { ok: boolean; payload?: XopcPersonalFile; }
interface XopcPersonalResult { invocationId: string; content: (XopcPersonalJson | XopcPersonalFile)[]; }
interface XopcPersonalHeaders { Authorization: string; 'Content-Type': string; 'x-endpoint-id': string; 'x-endpoint-upload-token': string; }
interface XopcPersonalPending { cancel: () => void; }
let xopcPersonalContext: common.UIAbilityContext | undefined;
let xopcPersonalUi: UIContext | undefined;
let xopcPersonalBusy: boolean = false;
let xopcPersonalPicker: boolean = false;
const xopcPersonalPending: Map<string, XopcPersonalPending> = new Map<string, XopcPersonalPending>();
export function attachDevicePersonalTools(context: common.UIAbilityContext, ui: UIContext): void { xopcPersonalContext = context; xopcPersonalUi = ui; }
export function hasActivePersonalPicker(): boolean { return xopcPersonalPicker; }
export function cancelDevicePersonalTool(id: string): void { xopcPersonalPending.get(id)?.cancel(); }
export function cancelAllDevicePersonalTools(): void { xopcPersonalPending.forEach((pending: XopcPersonalPending): void => { pending.cancel(); }); }
export function invokeDevicePersonalTool(payload: Object, send: (kind: string, body: Object) => void): void {
  const request = payload as XopcPersonalInvocation;
  const names: string[] = ['mobile.file.pick', 'mobile.media.pick', 'mobile.camera.capture', 'mobile.contacts.pick', 'mobile.calendar.query_events', 'mobile.calendar.query_free_busy'];
  const index: number = names.indexOf(request.toolName);
  const fail = (code: string): void => { const status: XopcPersonalStatus = { invocationId: request.invocationId, code, message: 'Personal device request failed: ' + code }; send('tool.error', status); };
  if (index < 0) { fail('TOOL_NOT_FOUND'); return; }
  if (request.descriptorRevision !== DEVICE_TOOL_REVISIONS[index + 3]) { fail('TOOL_REVISION_MISMATCH'); return; }
  const calendar: boolean = index >= 4;
  const contactPick: boolean = index === 3;
  const args: XopcPersonalArgs = request.arguments;
  if (!args || request.confirmationRequired !== calendar
    || (calendar && (Object.keys(args).length !== 2 || !Number.isSafeInteger(args.startAt) || !Number.isSafeInteger(args.endAt) || args.startAt! < 0 || args.endAt! <= args.startAt! || args.endAt! - args.startAt! > 7 * 86400000))
    || (contactPick && (Object.keys(args).length !== 1 || ['phone', 'email'].indexOf(args.field ?? '') < 0))
    || (!calendar && !contactPick && Object.keys(args).length !== 0)) { fail('INVALID_ARGUMENTS'); return; }
  if (request.deadlineAt <= Date.now()) { fail('TOOL_TIMEOUT'); return; }
  if (!layoutState.foreground || !xopcPersonalContext || !xopcPersonalUi) { fail('ENDPOINT_NOT_FOREGROUND'); return; }
  if (xopcPersonalBusy) { fail('TOOL_BUSY'); return; }
  xopcPersonalBusy = true;
  const revision: number = gatewaySession.connectionRevision();
  let alive: boolean = true;
  let consent: XopcLocationConsentHandle | undefined;
  let upload: http.HttpRequest | undefined;
  const finish = (): void => { alive = false; clearTimeout(timer); consent?.cancel(); upload?.destroy(); xopcPersonalPending.delete(request.invocationId); };
  const cancel = (): void => { if (!alive) return; finish(); const status: XopcPersonalStatus = { invocationId: request.invocationId }; send('tool.cancelled', status); };
  const timer: number = setTimeout((): void => { if (!alive) return; finish(); fail('TOOL_TIMEOUT'); }, Math.min(120000, request.deadlineAt - Date.now()));
  xopcPersonalPending.set(request.invocationId, { cancel });
  const received: XopcPersonalStatus = { invocationId: request.invocationId }; send('tool.received', received);
  const assertActive = (): void => { if (!alive) throw new Error('TOOL_CANCELLED'); gatewaySession.assertConnection(revision); if (!layoutState.foreground) throw new Error('ENDPOINT_NOT_FOREGROUND'); };
  const waitForeground = async (): Promise<void> => { while (alive && !layoutState.foreground) { await new Promise<void>((resolve): void => { setTimeout(resolve, 30); }); } assertActive(); };
  const work = async (): Promise<void> => {
    try {
      const scope: string = calendar ? '读取 xopc 应用可访问的日历（不代表你的全部日历），范围 ' + new Date(args.startAt!).toLocaleString() + ' 至 ' + new Date(args.endAt!).toLocaleString() + '，最多 50 条' + (index === 5 ? '忙闲时间，不含标题。' : '时间和标题。') : '请在系统页面选择本次要提供给 Agent 的' + (contactPick ? (args.field === 'phone' ? '联系人电话号码' : '联系人邮箱') : '文件或照片') + '。';
      consent = openDeviceLocationConsent(xopcPersonalUi!, scope + '所选内容会发送给 Agent，并可能保存在聊天历史中。', '允许本次提供设备信息？');
      if (!await consent.answer) { if (alive) { finish(); fail('USER_DENIED'); } return; }
      assertActive();
      let content: XopcPersonalJson | XopcPersonalFile;
      if (calendar) {
        const permissions: Permissions[] = ['ohos.permission.READ_CALENDAR'];
        const granted = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(xopcPersonalContext!, permissions);
        await waitForeground();
        if (granted.authResults[0] !== 0) throw new Error('PERMISSION_DENIED');
        const calendars: calendarManager.Calendar[] = await calendarManager.getCalendarManager(xopcPersonalContext!).getAllCalendars();
        assertActive();
        const entries: XopcPersonalEvent[] = [];
        let truncated: boolean = false;
        const keys: (keyof calendarManager.Event)[] = ['instanceStartTime', 'instanceEndTime', 'startTime', 'endTime', 'isAllDay'];
        if (index === 4) keys.push('title');
        for (let c: number = 0; c < calendars.length; c++) {
          const events: calendarManager.Event[] = await calendars[c].queryEventInstances(args.startAt!, args.endAt!, undefined, keys);
          assertActive();
          for (let e: number = 0; e < events.length; e++) {
            const event: calendarManager.Event = events[e];
            const startAt: number = event.instanceStartTime ?? event.startTime;
            const endAt: number = event.instanceEndTime ?? event.endTime;
            if (endAt <= args.startAt! || startAt >= args.endAt!) continue;
            if (entries.length >= 50) { truncated = true; break; }
            const entry: XopcPersonalEvent = { startAt, endAt, allDay: event.isAllDay ?? false, busy: true };
            if (index === 4) entry.title = (event.title ?? '').slice(0, 500);
            entries.push(entry);
          }
        }
        entries.sort((a: XopcPersonalEvent, b: XopcPersonalEvent): number => a.startAt - b.startAt);
        const value: XopcPersonalCalendar = { capturedAt: Date.now(), startAt: args.startAt!, endAt: args.endAt!, timeZone: i18n.getTimeZone().getID(), accessScope: 'app_only', truncated, events: entries };
        content = { type: 'json', value };
      } else if (contactPick) {
        xopcPersonalPicker = true;
        const selected: contact.Contact[] = await contact.selectContacts({ isMultiSelect: false, maxSelectable: 1 });
        xopcPersonalPicker = false; await waitForeground();
        if (!selected.length) throw new Error('USER_DENIED');
        const chosen: contact.Contact = selected[0];
        const phones: string[] = args.field === 'phone' ? (chosen.phoneNumbers ?? []).slice(0, 1).map((phone: contact.PhoneNumber): string => phone.phoneNumber.slice(0, 100)) : [];
        const emails: string[] = args.field === 'email' ? (chosen.emails ?? []).slice(0, 1).map((email: contact.Email): string => email.email.slice(0, 320)) : [];
        const value: XopcPersonalContact = { id: request.invocationId, name: (chosen.name?.fullName || 'Selected contact').slice(0, 500), phones, emails };
        content = { type: 'json', value };
      } else {
        xopcPersonalPicker = true;
        const file: XopcChatAttachment | undefined = index === 0 ? await pickChatAttachment(xopcPersonalContext!, []) : await pickChatPhoto(xopcPersonalContext!, [], index === 2);
        xopcPersonalPicker = false; await waitForeground();
        if (!file) throw new Error('USER_DENIED');
        const grant: XopcPersonalGrant | undefined = request.uploadGrant;
        if (!grant || grant.path !== '/api/endpoint-tools/invocations/' + request.invocationId + '/files' || grant.expiresAt <= Date.now() || file.size > grant.maxBytes) throw new Error('PERMISSION_DENIED');
        const auth = await gatewaySession.transferAuth(); assertActive();
        const profile = gatewaySession.currentProfile(); if (!profile) throw new Error('PERMISSION_DENIED');
        const bytes: Uint8Array = await new util.Base64Helper().decode(file.data ?? '');
        const headers: XopcPersonalHeaders = { Authorization: 'Bearer ' + auth.token, 'Content-Type': file.mimeType, 'x-endpoint-id': 'harmonyos:' + profile.deviceId, 'x-endpoint-upload-token': grant.token };
        upload = http.createHttp();
        try {
          const response = await signedHttpRequest(upload, auth.origin + grant.path + '?name=' + encodeURIComponent(file.name), { method: http.RequestMethod.POST, header: headers, extraData: bytes.buffer, maxRedirects: 0, readTimeout: 60000, expectDataType: http.HttpDataType.STRING, usingCache: false });
          assertActive();
          const result = JSON.parse(response.result as string) as XopcPersonalFileEnvelope;
          if (response.responseCode !== 201 || !result.ok || !result.payload) throw new Error('PERMISSION_DENIED');
          content = result.payload;
        } finally { bytes.fill(0); upload.destroy(); upload = undefined; }
      }
      assertActive(); finish(); const result: XopcPersonalResult = { invocationId: request.invocationId, content: [content] }; send('tool.result', result);
    } catch (error) {
      if (alive) { const message: string = (error as Error).message; finish(); fail(['USER_DENIED', 'ENDPOINT_NOT_FOREGROUND', 'RESULT_TOO_LARGE'].includes(message) ? message : 'PERMISSION_DENIED'); }
    } finally { xopcPersonalPicker = false; xopcPersonalBusy = false; }
  };
  work();
}
