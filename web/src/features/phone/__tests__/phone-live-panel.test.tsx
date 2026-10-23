// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../phone-live-api', async importOriginal => ({ ...await importOriginal<typeof import('../phone-live-api')>(), phoneFrame: vi.fn(), controlPhone: vi.fn() }));
import { PhoneLivePanel } from '../phone-live-panel';
import { controlPhone, phoneFrame, type PhoneLiveState } from '../phone-live-api';
import { useLocaleStore } from '@/stores/locale-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('keeps preview refreshing while a manual input acknowledgement is pending', async () => {
  vi.useFakeTimers(); useLocaleStore.setState({ language: 'zh' });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:live'), revokeObjectURL: vi.fn() });
  const state: PhoneLiveState = { report: { sessionId: 'phone', deviceName: 'Emulator', agentId: 'main', modelRef: 'phone/model', status: 'paused', mode: 'control', controlOwner: 'human', controlEpoch: 2, handoff: 'idle', actions: 0, modelRequests: 0, updatedAt: Date.now() }, ownControl: true, frame: null };
  let finish!: (value: PhoneLiveState) => void;
  vi.mocked(controlPhone).mockImplementation(async (_id, _state, op) => op === 'input' ? new Promise(resolve => { finish = resolve; }) : state);
  vi.mocked(phoneFrame).mockImplementation(async () => ({ blob: new Blob(['pixels']), width: 100, height: 200, seq: 1, capturedAt: Date.now() }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<PhoneLivePanel conversationId="conversation" state={state} onChange={vi.fn()} />));
  const before = vi.mocked(phoneFrame).mock.calls.length;
  await act(async () => (container!.querySelector('[aria-label="手机返回"]') as HTMLButtonElement).click());
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(vi.mocked(phoneFrame).mock.calls.length).toBeGreaterThan(before);
  expect(controlPhone).toHaveBeenCalledWith('conversation', state, 'input', expect.objectContaining({ action: { type: 'back' } }));
  await act(async () => finish(state));
});

function session(overrides: Partial<PhoneLiveState['report']> = {}, ownControl = false): PhoneLiveState {
  return { report: { sessionId: 'phone', deviceName: 'Cloud phone', agentId: 'main', modelRef: 'phone/model', status: 'paused', mode: 'control', controlOwner: 'none', controlEpoch: 2, handoff: 'idle', actions: 1, modelRequests: 0, updatedAt: Date.now(), ...overrides }, ownControl, frame: null };
}
async function mountPanel(state: PhoneLiveState) {
  useLocaleStore.setState({ language: 'zh' });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:live'), revokeObjectURL: vi.fn() });
  vi.mocked(phoneFrame).mockResolvedValue({ blob: new Blob(['pixels']), width: 720, height: 1280, seq: 1, capturedAt: Date.now() });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<PhoneLivePanel conversationId="conversation" state={state} onChange={vi.fn()} />));
}
function button(label: string) {
  const match = [...container!.querySelectorAll('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label);
  expect(match, `Button ${label}`).toBeDefined();
  return match!;
}

it('takes over a paused session instead of resuming the Agent and locks input until ownership is confirmed', async () => {
  const state = session();
  let finish!: (value: PhoneLiveState) => void;
  vi.mocked(controlPhone).mockImplementation(async () => new Promise(resolve => { finish = resolve; }));
  await mountPanel(state);
  expect(container!.querySelector('[aria-label="手机输入"]')).toBeNull();
  await act(async () => button('接管手机').click());
  expect(controlPhone).toHaveBeenLastCalledWith('conversation', state, 'takeover', expect.any(Object));
  expect(button('正在接管…').disabled).toBe(true);
  expect(container!.querySelector('[aria-label="手机输入"]')).toBeNull();
  await act(async () => finish(state));
});

it('keeps releasing control and handing back to the Agent as separate actions', async () => {
  const state = session({ controlOwner: 'human' }, true);
  vi.mocked(controlPhone).mockResolvedValue(state);
  await mountPanel(state);
  await act(async () => button('手机输入').click());
  expect(container!.querySelector('[aria-label="发送到手机的文本"]')).not.toBeNull();
  await act(async () => button('仅查看').click());
  expect(container!.querySelector('[aria-label="发送到手机的文本"]')).toBeNull();
  expect(controlPhone).toHaveBeenLastCalledWith('conversation', state, 'release', expect.any(Object));
  await act(async () => button('交还 Agent').click());
  expect(controlPhone).toHaveBeenLastCalledWith('conversation', state, 'handback', expect.any(Object));
  expect(container!.querySelector('[data-phone-device-shell]')?.getAttribute('style')).toContain('0.5625');
});

it('prevents takeover in observe mode and when another window owns control', async () => {
  const state = session({ controlOwner: 'human' });
  await mountPanel(state);
  expect(button('接管手机').disabled).toBe(true);
  expect(container!.querySelector('[aria-label="手机输入"]')).toBeNull();
  await act(async () => root!.render(<PhoneLivePanel conversationId="conversation" state={session({ mode: 'observe' })} onChange={vi.fn()} />));
  expect([...container!.querySelectorAll('button')].some(b => b.textContent === '接管手机')).toBe(false);
});

it('leaves ended sessions inert and keeps diagnostics collapsed until requested', async () => {
  await mountPanel(session({ status: 'closed' }));
  expect(container!.querySelector('canvas')?.className).toContain('hidden');
  expect([...container!.querySelectorAll('button')].some(b => b.textContent === '接管手机')).toBe(false);
  const details = button('连接详情');
  expect(details.getAttribute('aria-expanded')).toBe('false');
  expect(document.getElementById(details.getAttribute('aria-controls')!)?.hidden).toBe(true);
  await act(async () => details.click());
  expect(document.getElementById(details.getAttribute('aria-controls')!)?.hidden).toBe(false);
});
