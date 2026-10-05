import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn(), read: vi.fn(), gatewayId: 'gateway-a' };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  request: mock.request, currentProfile: () => ({ gatewayId: mock.gatewayId })
} }));
vi.mock('../entry/src/main/ets/service/localSessionStore.ets', () => ({ localSessionStore: { read: mock.read } }));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class { uuid() { return 'action-uuid'; } } }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error { status: number;
  constructor(status: number) { super('HTTP_' + status); this.status = status; } } }));

import { XopcConnectionWaitViewModel } from '../entry/src/main/ets/viewmodel/connectionWaitViewModel.ets';
import { XopcHttpError } from '../entry/src/main/ets/service/transport.ets';

const wait = (version = 1) => ({ id: 'wait-one', conversationId: 'session-one', summary: 'Read Gmail',
  objectiveUpdatedAt: 1, version, phase: 'needs_connection', needs: [{ key: 'gmail', label: 'Gmail',
    target: { type: 'connector', connectorId: 'composio-gmail' }, authorizationMode: 'browser',
    capabilities: ['email.read'], phase: 'connect', accounts: [] }] });
const response = (value: ReturnType<typeof wait> | null, revision = 1) => JSON.stringify({ payload: {
  transcriptId: 'transcript-one', revision, wait: value
} });

describe('mobile connection wait', () => {
  let model: XopcConnectionWaitViewModel;
  beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks(); mock.gatewayId = 'gateway-a'; mock.read.mockResolvedValue(undefined);
    mock.request.mockResolvedValue(response(wait())); model = new XopcConnectionWaitViewModel();
  });
  afterEach(() => { model.dispose(); vi.useRealTimers(); });

  it('waits for local drafts to materialize and polls only while a wait exists', async () => {
    mock.read.mockResolvedValueOnce({ conversationId: 'session-one' });
    model.start('session-one'); await vi.advanceTimersByTimeAsync(0);
    expect(mock.request).not.toHaveBeenCalled();
    await model.refresh(); expect(model.snapshot?.wait?.needs[0].label).toBe('Gmail');
    await vi.advanceTimersByTimeAsync(5000); expect(mock.request).toHaveBeenCalledTimes(2);
    mock.request.mockResolvedValue(response(null, 2)); await model.refresh();
    await vi.advanceTimersByTimeAsync(10000); expect(mock.request).toHaveBeenCalledTimes(3);
  });

  it('sends the current wait version and returns the browser authorization URL', async () => {
    model.start('session-one'); await vi.advanceTimersByTimeAsync(0);
    mock.request.mockResolvedValueOnce(JSON.stringify({ payload: { snapshot: JSON.parse(response(wait(2), 2)).payload,
      authorizationUrl: 'https://connect.example/authorize' } }));
    expect(await model.act('connect', 'gmail')).toBe('https://connect.example/authorize');
    const call = mock.request.mock.calls.find(item => item[1] === 'POST');
    expect(JSON.parse(call![2])).toMatchObject({ action: 'connect', needKey: 'gmail', waitId: 'wait-one',
      expectedTranscriptId: 'transcript-one', expectedVersion: 1, idempotencyKey: 'action-uuid' });
    expect(model.snapshot?.wait?.version).toBe(2);
  });

  it('discards old Gateway results and refreshes a changed wait after a conflict', async () => {
    model.start('session-one'); await vi.advanceTimersByTimeAsync(0);
    mock.request.mockRejectedValueOnce(new XopcHttpError(409));
    mock.request.mockResolvedValue(response(wait(2), 2));
    await model.act('check'); await vi.advanceTimersByTimeAsync(0);
    expect(model.snapshot?.wait?.version).toBe(2);
    mock.gatewayId = 'gateway-b'; model.start('session-two');
    mock.request.mockResolvedValue(response(null, 3)); await vi.advanceTimersByTimeAsync(0);
    expect(model.snapshot?.wait).toBeNull();
  });

  it('checks authorization as soon as the app returns to the foreground', async () => {
    mock.request.mockResolvedValue(response({ ...wait(), needs: [{ ...wait().needs[0], phase: 'authorizing' }] }));
    model.start('session-one'); await vi.advanceTimersByTimeAsync(0);
    model.pause();
    mock.request.mockImplementation((_path: string, method?: string) => Promise.resolve(method === 'POST'
      ? JSON.stringify({ payload: { snapshot: JSON.parse(response(null, 2)).payload } })
      : response({ ...wait(), needs: [{ ...wait().needs[0], phase: 'authorizing' }] })));
    model.onReturn(); await vi.advanceTimersByTimeAsync(0);
    expect(mock.request.mock.calls.some(item => item[1] === 'POST' && JSON.parse(item[2]).action === 'check')).toBe(true);
    expect(model.snapshot?.wait).toBeNull();
  });
});
