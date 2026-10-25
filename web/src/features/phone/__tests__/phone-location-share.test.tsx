// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ api: vi.fn(), fetch: vi.fn(), mutate: vi.fn(), geo: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ apiFetch: mocks.api, fetchJson: mocks.fetch }));
vi.mock('swr', () => ({ default: () => ({ data: { status: 'clean' }, mutate: mocks.mutate }) }));
vi.mock('@/features/endpoint-tools/turn-claim', () => ({ waitForEndpointTurnClaim: async () => ({ type: 'endpoint', endpointId: 'phone-source', token: 'token'.repeat(8) }) }));
vi.mock('@/features/endpoint-tools/context-publisher', () => ({ refreshLocalEndpointContext: async () => {} }));
import { PhoneLocationShare } from '../phone-location-share';
import { useLocaleStore } from '@/stores/locale-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const phoneId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const shareId = '33333333-3333-4333-8333-333333333333';
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); useLocaleStore.setState({ language: 'zh' });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: mocks.geo } });
  mocks.api.mockImplementation(async (path, init) => {
    const base = { id: shareId, endpointId: 'phone-source', conversationId, phoneId, mode: 'once', precision: 'approximate', expiresAt: Date.now() + 120_000 };
    const payload = init.method === 'DELETE' ? { ...base, status: 'revoked', sync: 'clean' }
      : String(path).endsWith('/samples') ? { ...base, status: 'fresh', sync: 'applied', validUntil: Date.now() + 30_000 }
        : { ...base, status: 'waiting', sync: 'pending' };
    return { ok: true, json: async () => ({ ok: true, payload }) };
  });
  mocks.fetch.mockResolvedValue({ payload: [] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
function button(text: string) { return [...document.querySelectorAll('button')].find(button => button.textContent === text || button.getAttribute('aria-label') === text)!; }
async function openAndAgree() {
  await act(async () => root.render(<PhoneLocationShare phoneId={phoneId} conversationId={conversationId} />));
  await act(async () => button('共享当前位置').click());
  expect(mocks.geo).not.toHaveBeenCalled();
  await act(async () => button('同意并共享').click());
}
it('collects only after consent, rounds approximate coordinates and revokes on stop', async () => {
  mocks.geo.mockImplementation(success => success({ timestamp: Date.now(), coords: { latitude: 31.234567, longitude: 121.345678, accuracy: 10 } }));
  await openAndAgree();
  expect(mocks.geo).toHaveBeenCalledOnce();
  const upload = mocks.api.mock.calls.find(([path]) => String(path).endsWith('/samples'));
  expect(JSON.parse(upload![1].body).sample).toMatchObject({ latitude: 31.24, longitude: 121.34, accuracyMeters: 3000, precision: 'approximate' });
  await act(async () => button('停止共享位置').click());
  expect(mocks.api.mock.calls.some(([, init]) => init.method === 'DELETE')).toBe(true);
});
it('ignores a late OS callback after the user leaves the view', async () => {
  let success!: (value: unknown) => void;
  mocks.geo.mockImplementation(callback => { success = callback; });
  await openAndAgree();
  await act(async () => root.unmount());
  await act(async () => success({ timestamp: Date.now(), coords: { latitude: 31, longitude: 121, accuracy: 10 } }));
  expect(mocks.api.mock.calls.some(([path]) => String(path).endsWith('/samples'))).toBe(false);
  expect(mocks.api.mock.calls.some(([, init]) => init.method === 'DELETE')).toBe(true);
});
it('revokes the grant when location permission is denied', async () => {
  mocks.geo.mockImplementation((_success, fail) => fail({ code: 1 }));
  await openAndAgree();
  expect(mocks.api.mock.calls.some(([path]) => String(path).endsWith('/samples'))).toBe(false);
  expect(mocks.api.mock.calls.some(([, init]) => init.method === 'DELETE')).toBe(true);
});
it('revokes an active share when the browser reports system permission withdrawal', async () => {
  const permission = new EventTarget() as EventTarget & { state: string }; permission.state = 'granted';
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => permission } });
  mocks.geo.mockImplementation(success => success({ timestamp: Date.now(), coords: { latitude: 31, longitude: 121, accuracy: 10 } }));
  await openAndAgree();
  await act(async () => { permission.state = 'denied'; permission.dispatchEvent(new Event('change')); });
  expect(mocks.api.mock.calls.some(([, init]) => init.method === 'DELETE')).toBe(true);
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
});
