import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn(), connectionRevision: vi.fn(), assertConnection: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: mocks }));
vi.mock('@kit.NetworkKit', () => ({ http: {} }));
import { XopcHttpError } from '../entry/src/main/ets/service/transport.ets';
import { XopcPersonalAgentSettingsViewModel } from '../entry/src/main/ets/viewmodel/personalAgentSettingsViewModel.ets';

const record = { agentId: 'personal', conversationId: 'fixed', state: 'ready' as const, displayName: 'Ada',
  appearance: 'loopi', errorMessage: null, revision: 7,
  voiceCallPreferences: { openingGreetingEnabled: true },
  voicePreference: { provider: 'old', model: 'old-tts', voice: 'existing' } };
const outreach = { revision: 3, mode: 'balanced', timezone: 'Asia/Shanghai', quietStart: 22, quietEnd: 8,
  dailyMessages: 4, dailyModelCalls: 20 };

describe('Personal AI settings on HarmonyOS', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.connectionRevision.mockReturnValue(1);
    mocks.request.mockImplementation(async (path: string) => {
      if (path === '/api/personal-agent') return JSON.stringify({ ok: true, payload: record });
      if (path === '/api/personal-agent/proactivity') return JSON.stringify({ ok: true, payload: outreach });
      if (path === '/api/voice/realtime/status') return JSON.stringify({ payload: { tts: { provider: 'new', model: 'tts' } } });
      return JSON.stringify({ ok: true, payload: { voices: [{ id: 'other', name: 'Other', displayNames: { 'zh-CN': '温暖', en: 'Other' } }] } });
    });
  });

  it('loads each capability and preserves the existing voice when the default route changes', async () => {
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    expect(model.voices).toEqual([{ id: 'other', name: 'Other', displayNames: { 'zh-CN': '温暖', en: 'Other' } }]);
    mocks.request.mockResolvedValueOnce(JSON.stringify({ ok: true, payload: { ...record, revision: 8 } }));
    await model.saveProfile('Ada', 'loopi', 'existing');
    const patch = JSON.parse(mocks.request.mock.calls.at(-1)![2]);
    expect(patch).toMatchObject({ revision: 7, voicePreference: record.voicePreference });
    expect(model.record?.revision).toBe(8);
  });

  it('persists the opening preference separately from response style', async () => {
    const model = new XopcPersonalAgentSettingsViewModel(); await model.load(record);
    mocks.request.mockResolvedValueOnce(JSON.stringify({ ok: true, payload: { ...record,
      voiceCallPreferences: { openingGreetingEnabled: false } } }));
    await model.saveProfile('Ada', 'loopi', 'existing', false);
    const patch = JSON.parse(mocks.request.mock.calls.at(-1)![2]);
    expect(patch.voiceCallPreferences).toEqual({ openingGreetingEnabled: false });
    expect(patch).not.toHaveProperty('preferences');
  });

  it('does not load or write advanced outreach settings while editing a profile', async () => {
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    mocks.request.mockResolvedValueOnce(JSON.stringify({ ok: true, payload: record }));
    await model.saveProfile('Ada', 'loopi', 'existing');
    expect(mocks.request.mock.calls.some(([path]) => path.includes('/proactivity'))).toBe(false);
  });

  it('retains the profile and reports a rejected stale save', async () => {
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    mocks.request.mockRejectedValueOnce(new Error('Settings changed; reload before saving'));
    expect(await model.saveProfile('Changed', 'loopi', '')).toBeNull();
    expect(model.record).toEqual(record);
    expect(model.error).toContain('reload');
    expect(model.saving).toBe(false);
  });

  it('rebases a stale save once while preserving unchanged remote fields', async () => {
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    const latest = { ...record, revision: 8, appearance: 'loopi-care' };
    mocks.request.mockRejectedValueOnce(new XopcHttpError(409))
      .mockResolvedValueOnce(JSON.stringify({ ok: true, payload: latest }))
      .mockResolvedValueOnce(JSON.stringify({ ok: true, payload: { ...latest, revision: 9, displayName: 'Nova' } }));
    expect((await model.saveProfile('Nova', 'loopi', 'existing'))?.revision).toBe(9);
    const patch = JSON.parse(mocks.request.mock.calls.at(-1)![2]);
    expect(patch).toMatchObject({ revision: 8, displayName: 'Nova', appearance: 'loopi-care',
      voicePreference: record.voicePreference });
    expect(model.error).toBe('');
    expect(model.saving).toBe(false);
  });

  it('does not overwrite a concurrent edit to the same field', async () => {
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    mocks.request.mockRejectedValueOnce(new XopcHttpError(409))
      .mockResolvedValueOnce(JSON.stringify({ ok: true, payload: { ...record, revision: 8, displayName: 'Web name' } }));
    const before = mocks.request.mock.calls.length;
    expect(await model.saveProfile('Phone name', 'loopi', 'existing')).toBeNull();
    expect(mocks.request.mock.calls.length - before).toBe(2);
    expect(model.error).toBe('PERSONAL_PROFILE_CONFLICT');
    expect(model.record?.displayName).toBe('Ada');
    expect(model.saving).toBe(false);
  });

  it('stops after a second conflict and allows another explicit save attempt', async () => {
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    mocks.request.mockRejectedValueOnce(new XopcHttpError(409))
      .mockResolvedValueOnce(JSON.stringify({ ok: true, payload: { ...record, revision: 8 } }))
      .mockRejectedValueOnce(new XopcHttpError(409));
    expect(await model.saveProfile('Nova', 'loopi', 'existing')).toBeNull();
    expect(model.error).toBe('HTTP_409');
    expect(model.saving).toBe(false);
  });

  it('keeps profile editing available when voice is unavailable', async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === '/api/personal-agent') return JSON.stringify({ ok: true, payload: record });
      throw new Error('Unavailable');
    });
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    expect(model.record).toEqual(record);
    expect(model.loading).toBe(false);
    expect(model.voiceError).toBe('Unavailable');
  });

  it('ignores profile results after leaving the screen or changing connections', async () => {
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    let resolve!: (value: string) => void;
    mocks.request.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
    const pending = model.saveProfile('Changed', 'loopi', {}, 'existing');
    model.dispose();
    resolve(JSON.stringify({ ok: true, payload: { ...record, displayName: 'Changed' } }));
    expect(await pending).toBeNull();
    expect(model.record?.displayName).toBe('Ada');
    mocks.assertConnection.mockImplementation(() => { throw new Error('GATEWAY_CHANGED'); });
    const second = new XopcPersonalAgentSettingsViewModel();
    await second.load(record);
    expect(second.error).toBe('GATEWAY_CHANGED');
  });
});
