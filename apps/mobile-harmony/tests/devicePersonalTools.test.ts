import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ foreground: true, answer: vi.fn(), close: vi.fn(), permission: vi.fn(), contacts: vi.fn(), file: vi.fn(), photo: vi.fn(), instances: vi.fn(), upload: vi.fn(), destroy: vi.fn(), revision: 1 }));
vi.mock('@kit.AbilityKit', () => ({ abilityAccessCtrl: { createAtManager: () => ({ requestPermissionsFromUser: mocks.permission }) } }));
vi.mock('@kit.ArkUI', () => ({}));
vi.mock('@kit.ArkTS', () => ({ util: { Base64Helper: class { async decode(value: string) { return Uint8Array.from(Buffer.from(value, 'base64')); } } } }));
vi.mock('@kit.ContactsKit', () => ({ contact: { selectContacts: mocks.contacts } }));
vi.mock('@kit.CalendarKit', () => ({ calendarManager: { getCalendarManager: () => ({ getAllCalendars: async () => [{ queryEventInstances: mocks.instances }] }) } }));
vi.mock('@kit.LocalizationKit', () => ({ i18n: { getTimeZone: () => ({ getID: () => 'UTC' }) } }));
vi.mock('@kit.NetworkKit', () => ({ http: { createHttp: () => ({ request: mocks.upload, destroy: mocks.destroy }), RequestMethod: { POST: 'POST' }, HttpDataType: { STRING: 'string' } } }));
vi.mock('../entry/src/main/ets/service/layoutState', () => ({ layoutState: mocks }));
vi.mock('../entry/src/main/ets/service/deviceLocationConsent', () => ({ openDeviceLocationConsent: () => ({ answer: mocks.answer(), cancel: mocks.close }) }));
vi.mock('../entry/src/main/ets/service/chatAttachmentPicker', () => ({ pickChatAttachment: mocks.file }));
vi.mock('../entry/src/main/ets/service/chatPhotoPicker', () => ({ pickChatPhoto: mocks.photo }));
vi.mock('../entry/src/main/ets/service/gatewaySession', () => ({ gatewaySession: { connectionRevision: () => 1,
  assertConnection: (revision: number) => { if (revision !== mocks.revision) throw new Error('CHANGED'); },
  currentProfile: () => ({ deviceId: 'fixture' }), transferAuth: async () => ({ token: 'fixture-token', origin: 'https://gateway.example.test' }) } }));
import { attachDevicePersonalTools, invokeDevicePersonalTool, cancelDevicePersonalTool, cancelAllDevicePersonalTools } from '../entry/src/main/ets/service/devicePersonalTools';
import { DEVICE_TOOL_REVISIONS } from '../entry/src/main/ets/common/deviceToolCatalog';
function request(index: number, args: object = {}, overrides: object = {}) {
  const names = ['mobile.file.pick', 'mobile.media.pick', 'mobile.camera.capture', 'mobile.contacts.pick', 'mobile.calendar.query_events', 'mobile.calendar.query_free_busy'];
  return { invocationId: 'once', toolName: names[index], arguments: args, confirmationRequired: index >= 4,
    descriptorRevision: DEVICE_TOOL_REVISIONS[index + 3], deadlineAt: Date.now() + 120000,
    uploadGrant: { path: '/api/endpoint-tools/invocations/once/files', token: 'fixture-grant', maxBytes: 1024, expiresAt: Date.now() + 120000 }, ...overrides };
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mocks.foreground = true; mocks.revision = 1;
  mocks.answer.mockResolvedValue(true); mocks.permission.mockResolvedValue({ authResults: [0] });
  attachDevicePersonalTools({} as never, {} as never); });
afterEach(() => { cancelAllDevicePersonalTools(); vi.useRealTimers(); });
describe('Harmony personal information adapters', () => {
  it('requires consent and returns only one selected contact field', async () => {
    mocks.contacts.mockResolvedValue([{ name: { fullName: 'Fixture' }, phoneNumbers: [{ phoneNumber: '123' }, { phoneNumber: '456' }], emails: [{ email: 'private@example.test' }] }]);
    const send = vi.fn(); invokeDevicePersonalTool(request(3, { field: 'phone' }), send); await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.result', { content: [{ value: { name: 'Fixture', phones: ['123'], emails: [] } }] }]);
    expect(mocks.permission).not.toHaveBeenCalled();
  });
  it('does not disclose selected contact data after cancellation', async () => {
    let complete: (value: object[]) => void = () => {};
    mocks.contacts.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const send = vi.fn(); invokeDevicePersonalTool(request(3, { field: 'email' }), send); await vi.advanceTimersByTimeAsync(0);
    cancelDevicePersonalTool('once'); complete([{ name: { fullName: 'Private' }, emails: [{ email: 'private@example.test' }] }]); await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.at(-1)).toEqual(['tool.cancelled', { invocationId: 'once' }]);
    expect(send.mock.calls.some(call => call[0] === 'tool.result')).toBe(false);
  });
  it('queries recurring instances with selected fields and labels app-only coverage', async () => {
    mocks.instances.mockResolvedValue([{ title: 'Do not leak', startTime: 1, endTime: 2, instanceStartTime: 10, instanceEndTime: 20, isAllDay: false, description: 'private' }]);
    const send = vi.fn(); invokeDevicePersonalTool(request(5, { startAt: 5, endAt: 30 }), send); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.instances.mock.calls[0][3]).not.toContain('title'); expect(mocks.instances.mock.calls[0][3]).not.toContain('description');
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.result', { content: [{ value: { accessScope: 'app_only', events: [{ startAt: 10, endAt: 20, busy: true, allDay: false }] } }] }]);
    expect(JSON.stringify(send.mock.calls)).not.toContain('Do not leak');
  });
  it('returns uploaded file metadata, and blocks upload after profile changes or user cancellation', async () => {
    mocks.file.mockResolvedValue({ name: 'fixture.txt', mimeType: 'text/plain', size: 4, data: 'dGVzdA==' });
    mocks.upload.mockResolvedValue({ responseCode: 201, result: JSON.stringify({ ok: true, payload: { type: 'file', fileId: 'selected-file' } }) });
    const send = vi.fn(); invokeDevicePersonalTool(request(0), send); await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.result', { content: [{ type: 'file', fileId: 'selected-file' }] }]);
    expect(mocks.upload.mock.calls[0][1].header['x-endpoint-id']).toBe('harmonyos:fixture');
    let complete: (value: object) => void = () => {};
    mocks.file.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    invokeDevicePersonalTool(request(0), send); await vi.advanceTimersByTimeAsync(0); mocks.revision = 2;
    complete({ name: 'private.txt', mimeType: 'text/plain', size: 4, data: 'dGVzdA==' }); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });
  it('does not open selectors or request calendar access after user denial', async () => {
    mocks.answer.mockResolvedValueOnce(false); const send = vi.fn(); invokeDevicePersonalTool(request(4, { startAt: 1, endAt: 3 }), send); await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.at(-1)).toMatchObject(['tool.error', { code: 'USER_DENIED' }]); expect(mocks.permission).not.toHaveBeenCalled();
  });
});
