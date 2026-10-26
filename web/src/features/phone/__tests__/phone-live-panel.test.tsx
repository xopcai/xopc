// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../phone-live-api', async importOriginal => ({ ...await importOriginal<typeof import('../phone-live-api')>(), phoneFrame: vi.fn(), controlPhone: vi.fn(), setPhoneExecutionMode: vi.fn() }));
import { PhoneLivePanel } from '../phone-live-panel';
import { setPhoneExecutionMode, controlPhone, phoneFrame, type PhoneLiveState } from '../phone-live-api';
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
async function menuItem(label: string) {
  await act(async () => button('更多手机操作').click());
  await act(async () => button(label).click());
}

it('shows the saved task after restart without requesting unavailable video or screenshots', async () => {
  vi.mocked(phoneFrame).mockClear();
  await mountPanel(session({ reconnectRequired: true, assistanceId: 'saved-wait', status: 'needs_user' }));
  expect(container!.textContent).toContain('任务进度已保留');
  expect(phoneFrame).not.toHaveBeenCalled();
  expect(button('接管手机').disabled).toBe(false);
});

it('shows the takeover reason and tells the user how to continue the original task', async () => {
  const state = session({ status: 'needs_user', stopReason: 'user_takeover', message: '请在手机上完成验证码登录' });
  await mountPanel(state);
  expect(container!.textContent).toContain('请在手机上完成验证码登录');
  expect(container!.textContent).toContain('请接管手机完成所需操作');
  vi.mocked(controlPhone).mockResolvedValue(state);
  await act(async () => button('接管手机').click());
  expect(controlPhone).toHaveBeenLastCalledWith('conversation', state, 'takeover', expect.any(Object));
});

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
  await act(async () => button('恢复 AI 操作').click());
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
  expect(container!.querySelector('dl')).toBeNull();
  await menuItem('连接详情');
  expect(container!.querySelector('dl')).not.toBeNull();
  await act(async () => button('关闭连接详情').click());
  expect(container!.querySelector('dl')).toBeNull();
});

it('renders a shared global preview without manual controls or control side effects', async () => {
  vi.mocked(controlPhone).mockClear();
  useLocaleStore.setState({ language: 'zh' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const state = session({ status: 'running', controlOwner: 'human' }, true);
  await act(async () => root!.render(<PhoneLivePanel conversationId="device:phone" state={state} onChange={vi.fn()} readOnly />));
  expect([...container.querySelectorAll('button')].some(b => /接管手机|恢复 AI 操作|手机输入|手机返回/.test(b.textContent ?? ''))).toBe(false);
  await act(async () => root!.unmount()); root = undefined;
  expect(controlPhone).not.toHaveBeenCalled();
});

it('changes the next task preference without stopping the current task', async () => {
  const state = session({ status: 'running', executionMode: 'collaborative', nextExecutionMode: 'collaborative', task: { taskId: 'task' } });
  vi.mocked(setPhoneExecutionMode).mockResolvedValue({ ...state, report: { ...state.report, nextExecutionMode: 'direct' } });
  await mountPanel(state);
  expect(container!.textContent).not.toContain('下一任务');
  expect(container!.textContent).not.toContain('Beta');
  await menuItem('操作设置');
  await act(async () => button('下一任务执行方式').click());
  await act(async () => [...document.body.querySelectorAll('button')].find(b => b.textContent === '直接执行')!.click());
  expect(setPhoneExecutionMode).toHaveBeenLastCalledWith('conversation', state, 'direct', false);
  expect(controlPhone).not.toHaveBeenCalledWith('conversation', state, 'pause', expect.anything());
});

it('requires confirmation before switching the current task and locks it during human control', async () => {
  const state = session({ executionMode: 'collaborative', nextExecutionMode: 'direct', task: { taskId: 'task' } });
  vi.mocked(setPhoneExecutionMode).mockClear(); vi.mocked(setPhoneExecutionMode).mockResolvedValue(state);
  await mountPanel(state);
  await menuItem('操作设置');
  await act(async () => button('切换当前任务…').click());
  expect(setPhoneExecutionMode).not.toHaveBeenCalled();
  expect(container!.textContent).toContain('预算不会重置');
  await act(async () => button('暂停并切换').click());
  expect(setPhoneExecutionMode).toHaveBeenCalledWith('conversation', state, 'direct', true);
  await act(async () => root!.render(<PhoneLivePanel conversationId="conversation" state={{ ...state, ownControl: true, report: { ...state.report, controlOwner: 'human' } }} onChange={vi.fn()} />));
  expect(button('切换当前任务…').disabled).toBe(true);
});

it('opens controls over the phone without sending input and disables manual controls until closed', async () => {
  vi.mocked(controlPhone).mockClear();
  await mountPanel(session({ controlOwner: 'human' }, true));
  await act(async () => button('更多手机操作').click());
  const shade = container!.querySelector('.phone-control-shade');
  expect(container!.querySelector('.phone-device-screen')?.contains(shade)).toBe(true);
  expect(button('手机返回').disabled).toBe(true);
  const image = container!.querySelector('img')!;
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 720, height: 1280 } as DOMRect);
  await act(async () => {
    image.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 300 }));
    image.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 200, clientY: 300 }));
  });
  await act(async () => button('连接详情').click());
  expect(shade?.querySelector('dl')).not.toBeNull();
  expect(controlPhone).not.toHaveBeenCalled();
  await act(async () => button('收起控制中心').click());
  expect(container!.querySelector('.phone-control-shade')).toBeNull();
  expect(button('手机返回').disabled).toBe(false);
});

it('keeps manual control alive when the browser page is hidden', async () => {
  vi.useFakeTimers();
  const state = session({ controlOwner: 'human' }, true);
  vi.mocked(controlPhone).mockReset().mockResolvedValue(state);
  await mountPanel(state);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(vi.mocked(controlPhone).mock.calls.filter(call => call[2] === 'heartbeat')).toHaveLength(4);
  expect(vi.mocked(controlPhone).mock.calls.some(call => call[2] === 'release')).toBe(false);
});

it('renews control even when status polling replaces the change callback every second', async () => {
  vi.useFakeTimers();
  const state = session({ controlOwner: 'human' }, true);
  vi.mocked(controlPhone).mockReset().mockResolvedValue(state);
  await mountPanel(state);
  for (let index = 0; index < 20; index++) {
    await act(async () => root!.render(<PhoneLivePanel conversationId="conversation" state={state} onChange={vi.fn()} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  }
  expect(vi.mocked(controlPhone).mock.calls.filter(call => call[2] === 'heartbeat')).toHaveLength(4);
});
