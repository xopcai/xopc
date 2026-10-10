import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn(), connectionRevision: vi.fn(), assertConnection: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: mocks }));
import { XopcPersonalAgentSettingsViewModel } from '../entry/src/main/ets/viewmodel/personalAgentSettingsViewModel.ets';

const record = { agentId: 'personal', conversationId: 'fixed', state: 'ready' as const, displayName: 'Ada',
  appearance: 'loopi', errorMessage: null, revision: 7, preferences: { warmth: 'gentle', guidance: 'Keep context' },
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
      return JSON.stringify({ ok: true, payload: { voices: [{ id: 'other', name: 'Other' }] } });
    });
  });

  it('loads each capability and preserves the existing voice when the default route changes', async () => {
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    expect(model.voices).toEqual([{ id: 'other', name: 'Other' }]);
    mocks.request.mockResolvedValueOnce(JSON.stringify({ ok: true, payload: { ...record, revision: 8 } }));
    await model.saveProfile('Ada', 'loopi', record.preferences, 'existing');
    const patch = JSON.parse(mocks.request.mock.calls.at(-1)![2]);
    expect(patch).toMatchObject({ revision: 7, voicePreference: record.voicePreference, preferences: record.preferences });
    expect(model.record?.revision).toBe(8);
  });

  it('keeps unexposed daily limits and uses the current outreach revision', async () => {
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    mocks.request.mockResolvedValueOnce(JSON.stringify({ ok: true, payload: { ...outreach, revision: 4, mode: 'off' } }));
    expect(await model.saveOutreach('off', 'UTC', 0, 6)).toBe(true);
    expect(JSON.parse(mocks.request.mock.calls.at(-1)![2])).toEqual({ ...outreach, mode: 'off', timezone: 'UTC', quietStart: 0, quietEnd: 6 });
    expect(model.outreach?.revision).toBe(4);
  });

  it('retains the profile and reports a rejected stale save', async () => {
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    mocks.request.mockRejectedValueOnce(new Error('Settings changed; reload before saving'));
    expect(await model.saveProfile('Changed', 'loopi', {}, '')).toBeNull();
    expect(model.record).toEqual(record);
    expect(model.error).toContain('reload');
    expect(model.saving).toBe(false);
  });

  it('keeps profile editing available when voice and outreach are unavailable', async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === '/api/personal-agent') return JSON.stringify({ ok: true, payload: record });
      throw new Error('Unavailable');
    });
    const model = new XopcPersonalAgentSettingsViewModel();
    await model.load(record);
    expect(model.record).toEqual(record);
    expect(model.loading).toBe(false);
    expect(model.voiceError).toBe('Unavailable');
    expect(model.outreachError).toBe('Unavailable');
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
    expect(second.outreach).toBeNull();
  });
});
