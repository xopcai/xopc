import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ foreground: true, request: vi.fn() }));
vi.mock('@kit.LocalizationKit', () => ({ i18n: { getTimeZone: () => ({ getID: () => 'Asia/Shanghai' }), System: { getSystemLocale: () => 'zh-CN' } } }));
vi.mock('../entry/src/main/ets/service/gatewaySession', () => ({ gatewaySession: { request: state.request } }));
vi.mock('../entry/src/main/ets/service/layoutState', () => ({ layoutState: state }));
import { XopcEndpointContextPublisher } from '../entry/src/main/ets/service/endpointContext';

afterEach(() => vi.useRealTimers());
it('publishes basic context while foreground and stops sampling when background or disconnected', async () => {
  vi.useFakeTimers(); state.foreground = true;
  state.request.mockResolvedValue(JSON.stringify({ ok: true, payload: { connectionEpoch: 'epoch', revision: 0 } }));
  const publisher = new XopcEndpointContextPublisher(() => 'report');
  publisher.start({ type: 'endpoint', endpointId: 'harmony-phone', token: 'token' });
  await vi.advanceTimersByTimeAsync(0);
  expect(state.request.mock.calls.filter(([path]) => path.endsWith('/reports'))).toHaveLength(1);
  state.foreground = false;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(state.request.mock.calls.filter(([path]) => path.endsWith('/reports'))).toHaveLength(1);
  publisher.stop(); const count = state.request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(state.request).toHaveBeenCalledTimes(count);
});
