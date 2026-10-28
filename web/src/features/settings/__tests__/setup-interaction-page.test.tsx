// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ data: undefined as any, fetch: vi.fn(), mutate: vi.fn() }));
vi.mock('swr', () => ({ default: () => ({ data: mock.data, mutate: mock.mutate }) }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mock.fetch }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (read: any) => read({ language: 'zh' }) }));
vi.mock('../phone/phone-model-connection', () => ({ PhoneModelConnection: ({ onSave }: any) => <button onClick={() => { void onSave('test/phone'); }}>Save phone model</button> }));
vi.mock('../phone/add-phone-dialog', () => ({ AddPhoneDialog: ({ onAdded, onClose, initialMethod }: any) => <div role="dialog"><span>{initialMethod}</span><button onClick={() => { onAdded(); onClose(); }}>Save connection</button><button onClick={onClose}>Close without saving</button></div> }));

import { SetupInteractionPage } from '../setup-interaction-page';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
const conversationId = '4f2d17ea-601c-4bb4-b818-95ddf9a0f3f4';
function LocationProbe() { const value = useLocation(); return <output>{value.pathname}{value.search}</output>; }
beforeEach(() => {
  vi.clearAllMocks();
  mock.data = { id: 'goal', conversationId, revision: 3, state: 'configuring', source: 'aliyun', readiness: { model: { ref: '' }, devices: [], localDiscovery: [] } };
  mock.fetch.mockImplementation(async () => ({ payload: mock.data }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(step = 'model') {
  await act(async () => root.render(<MemoryRouter initialEntries={[`/configuration/phone/goal?conversationId=${conversationId}&step=${step}`]}><Routes><Route path="/configuration/:scene/:setupId" element={<SetupInteractionPage />} /><Route path="/chat/:conversationId" element={<p>Original chat</p>} /></Routes><LocationProbe /></MemoryRouter>));
}
function button(text: string) { return [...document.querySelectorAll('button')].find(node => node.textContent === text)!; }
it('saves only the current setup model, rechecks scope and returns to the original chat with a secret-free continuation', async () => {
  await render(); await act(async () => button('Save phone model').click());
  const [url, input] = mock.fetch.mock.calls[0];
  expect(url).toBe('/api/phone/setup');
  expect(JSON.parse(input.body)).toMatchObject({ action: 'set_model', setupId: 'goal', expectedRevision: 3, modelRef: 'test/phone' });
  const destination = container.querySelector('output')!.textContent!;
  expect(destination.startsWith(`/chat/${conversationId}?`)).toBe(true);
  const query = new URL(destination, 'https://xopc.test').searchParams;
  expect(query.get('autoSend')).toBe('1'); expect(query.get('draft')).toContain('重新检查');
});
it('does not revive a request cancelled while the model save was in progress', async () => {
  await render();
  mock.fetch.mockResolvedValueOnce({ payload: mock.data }).mockResolvedValueOnce({ payload: { ...mock.data, state: 'cancelled' } });
  await act(async () => button('Save phone model').click());
  expect(container.querySelector('output')!.textContent).toContain('/configuration/phone/goal');
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('原请求已变更');
});
it('opens only the cloud connection modal and resumes once after a real form save event', async () => {
  await render('connection'); expect(document.body.textContent).toContain('aliyun');
  await act(async () => button('Save connection').click());
  expect(container.querySelector('output')!.textContent).toContain(`/chat/${conversationId}?`);
  expect(mock.fetch).toHaveBeenCalledTimes(1);
});
it('closing an uncompleted credential step never submits a continuation', async () => {
  await render('connection'); await act(async () => button('Close without saving').click());
  expect(container.querySelector('output')!.textContent).toBe(`/chat/${conversationId}`);
  expect(mock.fetch).not.toHaveBeenCalled();
});
it.each([{ state: 'cancelled' }, { stale: true }, { conversationId: 'foreign-chat' }])('does not expose credential forms for an invalid original setup: %j', async patch => {
  mock.data = { ...mock.data, ...patch }; await render();
  expect(document.body.textContent).not.toContain('Save phone model');
  expect(document.querySelector('[role="alert"]')).not.toBeNull(); expect(mock.fetch).not.toHaveBeenCalled();
});
